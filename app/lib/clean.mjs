import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// 安全清理：只允许两个白名单动作，路径写死，不接受任意路径。
// 1) 用户临时目录里 7 天前的文件；2) 清空当前用户的回收站。
// 删除不可撤销，所以前端必须二次确认；这里再校验一次 key。

const execFileP = promisify(execFile);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CLEANABLE = new Set(['temp', 'recycle']);

function errText(e) {
  return String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160);
}

async function sweepTemp(root, cutoff) {
  const out = { freed: 0, files: 0, skipped: 0, errors: [] };
  const note = (e) => { out.skipped += 1; if (out.errors.length < 3) out.errors.push(errText(e)); };
  async function walk(dir) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { out.skipped += 1; return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      let st;
      try { st = await fsp.lstat(p); } catch { out.skipped += 1; continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        await walk(p);
        if (st.mtimeMs < cutoff) {
          try { await fsp.rmdir(p); } catch { /* 还有没删掉的文件，留着 */ }
        }
      } else if (st.isFile() && st.mtimeMs < cutoff) {
        try { await fsp.unlink(p); out.files += 1; out.freed += st.size; }
        catch (e) { note(e); }
      }
    }
  }
  if (!fs.existsSync(root)) return { ...out, exists: false };
  await walk(root);
  return { ...out, exists: true };
}

async function currentSid() {
  try {
    const r = await execFileP('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000 });
    const m = String(r.stdout || '').match(/S-1-5-[\d-]+/);
    return m ? m[0] : '';
  } catch { return ''; }
}

async function clearRecycle() {
  const sid = await currentSid();
  if (!sid) return { ok: false, freed: 0, files: 0, skipped: 0, detail: '读不到当前用户，没有动回收站' };
  const roots = ['C:\\$Recycle.Bin', 'D:\\$Recycle.Bin'].map((root) => path.join(root, sid));
  let files = 0, skipped = 0, errors = [];
  for (const root of roots) {
    let ents;
    try { ents = await fsp.readdir(root, { withFileTypes: true }); }
    catch { continue; }
    for (const e of ents) {
      const p = path.join(root, e.name);
      try {
        const st = await fsp.lstat(p);
        await fsp.rm(p, { recursive: st.isDirectory(), force: true });
        files += 1;
      } catch (err) {
        skipped += 1;
        if (errors.length < 3) errors.push(errText(err));
      }
    }
  }
  const ok = skipped === 0;
  return {
    ok, freed: 0, files, skipped,
    detail: ok ? '回收站已清空' : '回收站有 ' + skipped + ' 项没删掉（可能正被占用）',
    errors,
  };
}

export async function cleanSafe({ keys } = {}) {
  const wanted = [...new Set(Array.isArray(keys) ? keys : [])].filter((k) => CLEANABLE.has(k));
  if (!wanted.length) throw new Error('没有可清理的项');
  const t0 = Date.now();
  const items = [];
  for (const key of wanted) {
    if (key === 'temp') {
      const r = await sweepTemp(os.tmpdir(), Date.now() - MAX_AGE_MS);
      items.push({
        key, label: '用户临时文件',
        ok: r.exists,
        freed: r.freed, files: r.files, skipped: r.skipped,
        detail: r.exists ? '已删除 7 天前的临时文件' : '临时目录不存在',
        errors: r.errors,
      });
    } else if (key === 'recycle') {
      const r = await clearRecycle();
      items.push({ key, label: '回收站', ...r });
    }
  }
  return {
    ok: items.every((x) => x.ok),
    ms: Date.now() - t0,
    freed: items.reduce((n, x) => n + (x.freed || 0), 0),
    items,
  };
}