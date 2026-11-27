// 动作库：每个动作 = 描述 + 执行 + 撤销。
// 硬规矩：没有 revert 的动作不许进 L1（可一键执行的那一档）。
import { spawn } from 'node:child_process';
import { INSTALL_APPS, appById } from './catalog.mjs';

const PS_PRE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ";

export function runPS(script, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_PRE + script], { windowsHide: true });
    let out = '', err = '', done = false;
    const t = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} resolve({ code: -1, out, err: err + '\n[超时 ' + timeoutMs + 'ms]' }); } }, timeoutMs);
    p.stdout.on('data', b => out += b.toString('utf8'));
    p.stderr.on('data', b => err += b.toString('utf8'));
    p.on('close', c => { if (!done) { done = true; clearTimeout(t); resolve({ code: c, out, err }); } });
  });
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// winget 有时会先报「已安装/已卸载」，实际还没落盘。装完、卸完都以 winget list 为准，
// 否则日志会写一条「已撤销」，用户回头看软件还在。
async function wingetListed(id) {
  const r = await runPS('winget list --id ' + q(id) + ' -e --accept-source-agreements 2>&1 | Out-String', 120000);
  const out = String(r.out || '');
  if (/No installed package found|找不到已安装|未找到已安装/i.test(out)) return false;
  return out.includes(id);
}

// 一次 winget list 拿到当前真实已装，避免只信上次体检的缓存。
export async function wingetInstalledNames() {
  const r = await runPS('winget list --accept-source-agreements 2>&1 | Out-String', 60000);
  const out = String(r.out || '');
  if (!out || /No installed package found|找不到已安装|未找到已安装/i.test(out)) return [];
  return INSTALL_APPS.filter((a) => out.includes(a.id)).map((a) => a.name);
}

// 有的安装包（比如网易云）自带的 UnInstall.exe 不认 winget 的静默参数，
// winget 报成功但文件还在。补一次安装包自己的 /S 卸载，仍然以 winget list 验收。
async function silentUninstallByName(name) {
  const keys = "@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')";
  const script = '$keys = ' + keys + '; ' +
    '$p = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq ' + q(name) + ' } | Select-Object -First 1; ' +
    "if (-not $p) { 'NONE' } elseif (-not $p.UninstallString) { 'NOUNINST' } else { " +
    "$u = [string]$p.UninstallString; if ($u -match '^\"([^\"]+)\"') { $exe = $matches[1] } elseif ($u -match '^(.*?\.exe)(\s|$)') { $exe = $matches[1] } else { $exe = ($u -split ' ')[0] }; " +
    "if (-not (Test-Path $exe)) { 'NOEXE[' + $exe + ']' } else { $pr = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru -ErrorAction SilentlyContinue; 'EXIT=' + $pr.ExitCode } }";
  const r = await runPS(script, 300000);
  return String(r.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
}
// StartupApproved 的开关按注册表根分开存：HKCU 的启动项看 HKCU 那份，HKLM 的看 HKLM 那份。
// 写错根 = 写了也没人看。这里踩过坑：整机级自启报「已关闭」，实际照样开机启动。
const APPROVED_SUB = '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const DISABLED = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function rootOf(target) {
  const s = String((target && target.source) || '').toUpperCase();
  return s.startsWith('HKLM') ? 'HKLM' : 'HKCU';
}
const approvedPath = (root) => root + ':' + APPROVED_SUB;

let _admin = null;
async function isAdmin() {
  if (_admin !== null) return _admin;
  const r = await runPS('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)', 15000);
  _admin = /True/i.test(r.out);
  return _admin;
}

async function readApproved(root, name) {
  const script = '$k = ' + q(approvedPath(root)) + '; $v = (Get-ItemProperty -Path $k -Name ' + q(name) + ' -ErrorAction SilentlyContinue).' + q(name) + '; ' +
    "if ($null -eq $v) { 'NONE' } else { 'B' + ($v -join ',') }";
  const r = await runPS(script, 20000);
  const line = r.out.trim().split(/\r?\n/).filter(Boolean).pop() || 'NONE';
  if (!/^B/.test(line)) return { exists: false };
  return { exists: true, bytes: line.slice(1).split(',').map(Number) };
}

function setScript(root, name, bytes) {
  const k = q(approvedPath(root));
  return 'if (-not (Test-Path ' + k + ')) { New-Item -Path ' + k + ' -Force | Out-Null }; ' +
    'Set-ItemProperty -Path ' + k + ' -Name ' + q(name) + ' -Value ([byte[]](' + bytes.join(',') + ')) -Type Binary';
}
function delScript(root, name) {
  return 'Remove-ItemProperty -Path ' + q(approvedPath(root)) + ' -Name ' + q(name) + ' -ErrorAction SilentlyContinue';
}

// 整机级（HKLM）必须管理员。不偷偷提权：弹一次 UAC，点了「是」才写，点了「否」就当没发生。
// 脚本走 -EncodedCommand，不落临时文件：没有「先写文件再执行」之间被人替换的窗口。
async function elevate(script) {
  const full = "$ErrorActionPreference = 'Stop'\r\n" + script + '\r\n';
  const b64 = Buffer.from(full, 'utf16le').toString('base64');
  const r = await runPS(
    '$p = Start-Process -FilePath powershell -Verb RunAs -Wait -WindowStyle Hidden -PassThru ' +
    '-ArgumentList @(' + q('-NoProfile') + ',' + q('-ExecutionPolicy') + ',' + q('Bypass') + ',' + q('-EncodedCommand') + ',' + q(b64) + '); ' +
    "if ($p) { 'EXIT=' + $p.ExitCode } else { 'EXIT=?' }", 180000);
  const m = r.out.match(/EXIT=(-?\d+)/);
  return { ok: !!m && m[1] === '0', err: (r.err || '').trim().slice(0, 200) };
}

async function applyMark(root, name, bytes) {
  if (root === 'HKLM' && !(await isAdmin())) return elevate(setScript(root, name, bytes));
  const r = await runPS(setScript(root, name, bytes), 20000);
  return { ok: r.code === 0, err: (r.err || '').trim().slice(0, 160) };
}
async function clearMark(root, name) {
  if (root === 'HKLM' && !(await isAdmin())) return elevate(delScript(root, name));
  const r = await runPS(delScript(root, name), 20000);
  return { ok: r.code === 0 };
}

export const ACTIONS = {
  disable_startup: {
    label: '关掉开机自启',
    level: 'L1',
    reversible: true,
    // 任务管理器同款做法：不改 Run 里的原条目，只写「禁用」标记；撤销 = 把原字节写回去。
    // HKCU 的项直接写；HKLM 的项要管理员，弹一次 UAC，写不进去就如实报失败，绝不报「已完成」。
    async run(target) {
      const root = rootOf(target);
      const prev = await readApproved(root, target.name);
      const w = await applyMark(root, target.name, DISABLED);
      if (!w.ok) {
        const elev = root === 'HKLM' && !(await isAdmin());
        return { ok: false, needsAdmin: elev, detail: elev ? '整机级自启要管理员，你取消了授权，这条我没动。' : '写入失败：' + (w.err || '') };
      }
      const now = await readApproved(root, target.name);
      if (!(now.exists && now.bytes[0] === 3)) return { ok: false, detail: '写进去了，但回读不是「已禁用」——我不把它算成功。' };
      return { ok: true, detail: '已关闭，并回读确认（原条目还在，只是不启动了）', revert: { kind: 'startup', root, name: target.name, prev } };
    },
    async revert(rev) {
      const root = rev.root || 'HKCU';
      const r = rev.prev && rev.prev.exists ? await applyMark(root, rev.name, rev.prev.bytes) : await clearMark(root, rev.name);
      if (!r.ok) return { ok: false, needsAdmin: root === 'HKLM', detail: '恢复失败：这条需要管理员权限，我没能写回去。' };
      const now = await readApproved(root, rev.name);
      const want = rev.prev && rev.prev.exists ? rev.prev.bytes[0] : 2;
      if (now.exists && now.bytes[0] !== want) return { ok: false, detail: '回读和原值不一致，我如实报失败。' };
      return { ok: true, detail: '已恢复原标记（回读确认）' };
    },
  },

  uninstall_app: {
    label: '卸载软件',
    level: 'L1',
    reversible: true,
    async check(target) {
      const r = await runPS('(Get-Command winget -ErrorAction SilentlyContinue) -ne $null', 15000);
      if (!/True/i.test(r.out)) return { ok: false, needsAdmin: false, reason: '这台机器没有 winget，卸载只能你自己去设置里点。' };
      return { ok: true };
    },
    async resolve(target) {
      // 用 winget list 精确对名字，对不上就不动——宁可不动，不可误删
      const r = await runPS('winget list --name ' + q(target.name) + ' --accept-source-agreements 2>$null | Out-String', 60000);
      const lines = r.out.split(/\r?\n/).filter(l => l.trim() && !/^\s*-+\s*$/.test(l) && !/^(Name|名称)/.test(l));
      const hit = lines.find(l => l.toLowerCase().includes(String(target.name).toLowerCase()));
      if (!hit) return null;
      const cols = hit.split(/\s{2,}/);
      return { id: cols[1], name: cols[0] };
    },
    async run(target) {
      const hit = await this.resolve(target);
      if (!hit || !hit.id) return { ok: false, detail: 'winget 里找不到完全对应的条目，为免误删，跳过了。' };
      const r = await runPS('winget uninstall --id ' + q(hit.id) + ' -e --silent --accept-source-agreements 2>&1 | Out-String', 300000);
      const ok = /Successfully uninstalled|已成功卸载/i.test(r.out);
      return {
        ok,
        detail: ok ? '已卸载 ' + hit.name : '没卸成功：' + r.out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 200),
        revert: ok ? { kind: 'winget', id: hit.id } : null,
      };
    },
    async revert(rev) {
      const r = await runPS('winget install --id ' + q(rev.id) + ' -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-String', 600000);
      return { ok: /Successfully installed|已成功安装/i.test(r.out), detail: '重装 ' + rev.id };
    },
  },

  install_app: {
    label: '安装软件',
    level: 'L1',
    reversible: true,
    async check(target) {
      const app = appById(target && target.id);
      if (!app) return { ok: false, reason: '这个包不在装机清单里，我不装。' };
      const r = await runPS('(Get-Command winget -ErrorAction SilentlyContinue) -ne $null', 15000);
      if (!/True/i.test(r.out)) return { ok: false, reason: '这台机器没有 winget，装不了；可以去官网下载安装包。' };
      return { ok: true };
    },
    async run(target) {
      const app = appById(target && target.id);
      if (!app) return { ok: false, detail: '这个包不在装机清单里，我不装。' };
      const r = await runPS(
        'winget install --id ' + q(app.id) + ' -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-String',
        600000);
      const out = String(r.out || '');
      const installed = /Successfully installed|已成功安装/i.test(out);
      const already = /already installed|已安装|found an existing package/i.test(out);
      if (!installed) {
        const tail = out.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 220);
        return { ok: false, detail: already ? '系统里已经有这个包了，我不重复装；重新体检一次就能看到。' : ('没装成功：' + (tail || 'winget 没有返回结果')) };
      }
      // winget 说装好了不算数：再查一次系统里有没有这个包。
      await new Promise(r => setTimeout(r, 1500));
      let listed = await wingetListed(app.id);
      if (!listed) { await new Promise(r => setTimeout(r, 3000)); listed = await wingetListed(app.id); }
      if (!listed) return { ok: false, detail: 'winget 说装好了，但系统里查不到 ' + app.name + '。可能安装器还在后台跑，或者被安全软件拦了；重新体检一次再看看。' };
      return {
        ok: true,
        detail: '已安装 ' + app.name + '（装完可撤销：卸载刚装的这个）',
        revert: { kind: 'winget', id: app.id, name: app.name },
      };
    },
    async revert(rev) {
      const r = await runPS('winget uninstall --id ' + q(rev.id) + ' -e --silent --accept-source-agreements 2>&1 | Out-String', 600000);
      const out = String(r.out || '');
      const saidOk = /Successfully uninstalled|已成功卸载/i.test(out);
      const notThere = /No installed package found|找不到已安装|未找到已安装/i.test(out);
      const tail = out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 180);
      if (!saidOk && !notThere) return { ok: false, detail: '卸载没成功：' + (tail || 'winget 没有返回结果') };
      // winget 报成功也可能只是卸载器提前退出；以系统里还能不能查到为准。
      await new Promise(r => setTimeout(r, 1500));
      let gone = !(await wingetListed(rev.id));
      let fallback = '';
      if (!gone && rev.name) {
        fallback = await silentUninstallByName(rev.name);
        await new Promise(r => setTimeout(r, 1500));
        gone = !(await wingetListed(rev.id));
      }
      if (!gone) {
        return { ok: false, detail: '卸载没完成：winget 报了成功，但系统里还能查到 ' + (rev.name || rev.id) + '。去「设置 → 应用」里手动卸一次，或重启后再试。' };
      }
      return { ok: true, detail: '已卸载刚装的 ' + (rev.name || rev.id) + (fallback ? '（用安装包自带的卸载器补完）' : '') };
    },
  },

  enable_firewall: {
    label: '打开防火墙',
    level: 'L2',
    reversible: true,
    needsAdmin: true,
    async run() { return { ok: false, detail: '要管理员权限，这个版本不代劳。' }; },
    async revert() { return { ok: true, detail: '无需恢复' }; },
  },

  open_settings: {
    label: '带到设置页',
    level: 'L0',
    reversible: false,
    async run(target) {
      const want = (target && target.uri) || 'ms-settings:';
      // 只放行系统设置页。这个参数会交给 cmd /c start，必须在这里再挡一次，
      // 否则本地接口被别的页面敲进来时，什么路径/网址都能被它打开。
      const uri = /^ms-settings:[a-z0-9]*$/i.test(want) ? want : 'ms-settings:';
      await new Promise(res => {
        const p = spawn('cmd', ['/c', 'start', '', uri], { windowsHide: true, detached: true, stdio: 'ignore' });
        p.on('close', res); p.on('error', res);
        setTimeout(res, 1500);
      });
      return { ok: true, detail: '已经把设置页打开在你屏幕上了', revert: null };
    },
    async revert() { return { ok: true, detail: '' }; },
  },
};

export const CATALOG = [
  { action: 'disable_startup', desc: '关掉一个开机自启项（HKCU 直接关；整机级 HKLM 会弹一次 UAC，可撤销）', params: { name: '自启项名字，必须原样来自 startup 列表', source: '该自启项的 source 字段' } },
  { action: 'install_app', desc: '从内置装机清单里安装一个软件（winget，装完可卸载；只接受清单里的 id）', params: { id: '清单里的包 id，必须原样' } },
  { action: 'open_settings', desc: '不执行，只把 Windows 设置页打开给用户自己点（L2 的替代）', params: { uri: '如 ms-settings:windowsdefender' } },
];