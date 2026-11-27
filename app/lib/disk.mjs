import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// 只读磁盘扫描：只算大小，不删任何文件。
// 目录大小是按“最多看多少个文件/多少毫秒”截断的，截断时用 >= 显示，不假装精确。

const GB = 1024 ** 3;
const MB = 1024 ** 2;

async function currentSid() {
  try {
    const r = await execFileP('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000 });
    const m = String(r.stdout || '').match(/S-1-5-[\d-]+/);
    return m ? m[0] : '';
  } catch { return ''; }
}

function driveInfo(letter) {
  const root = letter + ':\\';
  if (!fs.existsSync(root)) return { letter, exists: false };
  try {
    const s = fs.statfsSync(root);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    return { letter, exists: true, total, free, used: Math.max(0, total - free) };
  } catch {
    return { letter, exists: true, error: '读不到容量' };
  }
}

async function walkSize(root, opts = {}) {
  const maxEntries = opts.maxEntries || 8000;
  const maxMs = opts.maxMs || 2500;
  const collectTop = opts.collectTop || 0;
  const workers = opts.workers || 4;
  const out = { bytes: 0, files: 0, truncated: false, top: [] };
  if (!fs.existsSync(root)) return out;
  const start = Date.now();
  let stop = false;
  const queue = [root];
  const worker = async () => {
    while (!stop) {
      const dir = queue.pop();
      if (!dir) return;
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const e of ents) {
        if (stop) return;
        if (out.files >= maxEntries || Date.now() - start > maxMs) { out.truncated = true; stop = true; return; }
        if (e.isSymbolicLink()) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          queue.push(p);
          if (queue.length > 20000) { out.truncated = true; stop = true; return; }
        } else if (e.isFile()) {
          let st;
          try { st = await fsp.stat(p); } catch { continue; }
          out.files += 1;
          out.bytes += st.size;
          if (collectTop) {
            out.top.push({ path: p, name: e.name, bytes: st.size });
            out.top.sort((a, b) => b.bytes - a.bytes);
            if (out.top.length > collectTop) out.top.length = collectTop;
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

async function sizeOf(label, key, target, opts) {
  const exists = fs.existsSync(target);
  if (!exists) return { key, label, path: target, exists: false, bytes: 0, files: 0, truncated: false };
  const r = await walkSize(target, opts);
  return { key, label, path: target, exists: true, bytes: r.bytes, files: r.files, truncated: r.truncated };
}

async function largeFiles(roots) {
  const all = [];
  const seen = new Set();
  const results = await Promise.all(roots.map(async (root) => {
    if (!fs.existsSync(root.path)) return [];
    const r = await walkSize(root.path, { maxEntries: 15000, maxMs: 5000, collectTop: 30, workers: 4 });
    return r.top;
  }));
  for (const list of results) {
    for (const f of list) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      all.push(f);
    }
  }
  all.sort((a, b) => b.bytes - a.bytes);
  return all.slice(0, 12);
}

async function topDirs(drive) {
  const roots = [];
  if (drive === 'C') {
    roots.push(
      { path: 'C:\\Users', name: 'Users（所有用户）', drive },
      { path: 'C:\\Program Files', name: 'Program Files', drive },
      { path: 'C:\\Program Files (x86)', name: 'Program Files (x86)', drive },
      { path: 'C:\\ProgramData', name: 'ProgramData', drive },
    );
  } else {
    const root = drive + ':\\';
    if (!fs.existsSync(root)) return [];
    let ents = [];
    try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch {}
    const skip = /^(\$RECYCLE\.BIN|System Volume Information|Recovery|Config\.Msi|WindowsApps|\$WinREAgent|OneDriveTemp)$/i;
    for (const e of ents) {
      if (!e.isDirectory() || skip.test(e.name)) continue;
      if (/^[0-9a-f]{32}$/i.test(e.name)) continue;
      roots.push({ path: path.join(root, e.name), name: e.name, drive });
      if (roots.length >= 12) break;
    }
  }
  const out = await Promise.all(roots.map(async (r) => {
    const sz = await walkSize(r.path, { maxEntries: drive === 'C' ? 6000 : 4000, maxMs: drive === 'C' ? 2200 : 1600, workers: 4 });
    return { drive: r.drive, path: r.path, name: r.name, bytes: sz.bytes, files: sz.files, truncated: sz.truncated };
  }));
  return out;
}

let cache = { at: 0, data: null };
let running = null;

export async function scanDisk({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < 60000) return cache.data;
  if (running) return running;
  running = (async () => {
    const t0 = Date.now();
    const drives = ['C', 'D'].map(driveInfo);
    const local = process.env.LOCALAPPDATA || '';
    const win = process.env.SystemRoot || 'C:\\Windows';
    const sid = await currentSid();
    const recC = sid ? path.join('C:\\$Recycle.Bin', sid) : 'C:\\$Recycle.Bin';
    const recD = sid ? path.join('D:\\$Recycle.Bin', sid) : '';
    const cleanSpecs = [
      { key: 'temp', label: '用户临时文件', path: os.tmpdir() },
      { key: 'wintemp', label: 'Windows 临时文件', path: path.join(win, 'Temp') },
      { key: 'recycle', label: '回收站', path: recC },
      { key: 'update', label: 'Windows 更新缓存', path: path.join(win, 'SoftwareDistribution', 'Download') },
    ];
    if (local) {
      cleanSpecs.push(
        { key: 'chrome', label: 'Chrome 缓存', path: path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache') },
        { key: 'edge', label: 'Edge 缓存', path: path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache') },
      );
    }
    const cleanNotes = {
      temp: '只清 7 天前的文件',
      wintemp: '部分文件需要管理员权限；不清理',
      recycle: '当前用户的 C / D 回收站；只统计能读到的部分',
      update: '部分文件需要管理员权限；不清理',
      chrome: '只统计；清理请用浏览器自身设置',
      edge: '只统计；清理请用浏览器自身设置',
    };
    const cleanable = { temp: true, recycle: true };
    const clean = (await Promise.all(cleanSpecs.map((s) => sizeOf(s.label, s.key, s.path, { maxEntries: 6000, maxMs: 2200, workers: 4 }))))
      .map((x) => ({ ...x, cleanable: !!cleanable[x.key], note: cleanNotes[x.key] || '' }));

    // 回收站把 D 盘也算进来；清理时会一起清空。
    const recycle = clean.find((x) => x.key === 'recycle');
    if (recycle && recD) {
      const d = await sizeOf('回收站 D', 'recycleD', recD, { maxEntries: 6000, maxMs: 1800, workers: 4 });
      if (d.exists) {
        recycle.bytes = (recycle.bytes || 0) + d.bytes;
        recycle.files = (recycle.files || 0) + d.files;
        recycle.truncated = recycle.truncated || d.truncated;
        recycle.path = 'C:\\$Recycle.Bin; D:\\$Recycle.Bin';
      }
    }
    const dirs = (await Promise.all(['C', 'D'].map(topDirs))).flat().sort((a, b) => b.bytes - a.bytes).slice(0, 10);
    const home = os.homedir();
    const userRoots = ['Downloads', 'Desktop', 'Documents', 'Videos', 'Pictures'].map((n) => ({ path: path.join(home, n) }));
    const files = await largeFiles(userRoots);
    // 这个数字只算「我们能清」的项；浏览器缓存等只统计，不计入。
    const cleanupBytes = clean.filter((x) => x.cleanable).reduce((n, x) => n + (x.bytes || 0), 0);
    const data = {
      at: Date.now(),
      tookMs: Date.now() - t0,
      drives,
      clean,
      cleanupBytes,
      dirs,
      files,
      notes: [
        '目录大小按扫描上限截断，标「至少」的是下限，不是精确值。',
        '大文件只扫当前用户的下载 / 桌面 / 文档 / 视频 / 图片；D 盘看目录占用。',
        '扫描只读；清理只做用户临时文件和回收站，需二次确认。',
      ],
    };
    cache = { at: Date.now(), data };
    return data;
  })();
  try { return await running; } finally { running = null; }
}

export const fmtBytes = (n) => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n >= GB) return (n / GB).toFixed(1) + ' GB';
  if (n >= MB) return (n / MB).toFixed(0) + ' MB';
  return Math.max(0, Math.round(n / 1024)) + ' KB';
};