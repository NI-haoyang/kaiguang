// 动作库：每个动作 = 描述 + 执行 + 撤销。
// 硬规矩：没有 revert 的动作不许进 L1（可一键执行的那一档）。
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

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
const APPROVED = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

async function readApproved(name) {
  const script = '$k = ' + q(APPROVED) + '; $v = (Get-ItemProperty -Path $k -Name ' + q(name) + ' -ErrorAction SilentlyContinue).' + q(name) + '; ' +
    "if ($null -eq $v) { 'NONE' } else { 'B' + ($v -join ',') }";
  const r = await runPS(script, 20000);
  const line = r.out.trim().split(/\r?\n/).filter(Boolean).pop() || 'NONE';
  if (!/^B/.test(line)) return { exists: false };
  return { exists: true, bytes: line.slice(1).split(',').map(Number) };
}
const RUN_REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function parseRegValue(stdout) {
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s{4}(.+?)\s{4}(REG_[A-Z_]+)\s{4}([\s\S]*)$/);
    if (m) return { name: m[1], kind: m[2], value: m[3] };
  }
  return null;
}

export const ACTIONS = {
  disable_startup: {
    label: '关掉开机自启',
    level: 'L1',
    reversible: true,
    // 用任务管理器同款做法：不改 Run 里的原条目，只写「启用/禁用」标记。
    // 好处是一不需要管理员（HKLM 的项也能关），二是撤销就是把标记写回去，原条目一直在。
    async check(target) {
      const r = await runPS('[pscustomobject]@{ name = ' + q(target.name) + '; approved = (Test-Path ' + q(APPROVED) + ') } | ConvertTo-Json -Compress', 20000);
      return { ok: true };
    },
    async run(target) {
      const prev = await readApproved(target.name);
      const w = await runPS(
        'if (-not (Test-Path ' + q(APPROVED) + ')) { New-Item -Path ' + q(APPROVED) + ' -Force | Out-Null }; ' +
        'Set-ItemProperty -Path ' + q(APPROVED) + ' -Name ' + q(target.name) + ' -Value ([byte[]](3,0,0,0,0,0,0,0,0,0,0,0)) -Type Binary; ' +
        'Test-Path ' + q(APPROVED), 20000);
      if (w.code !== 0) return { ok: false, detail: '写入失败：' + (w.err || '').trim().slice(0, 160) };
      return { ok: true, detail: '已关闭（原条目还在注册表里，只是不启动了）', revert: { kind: 'startup', name: target.name, prev: prev } };
    },
    async revert(rev) {
      if (rev.prev && rev.prev.exists) {
        const r = await runPS('Set-ItemProperty -Path ' + q(APPROVED) + ' -Name ' + q(rev.name) + ' -Value ([byte[]](' + rev.prev.bytes.join(',') + ')) -Type Binary', 20000);
        return { ok: r.code === 0, detail: '已恢复原标记' };
      }
      const r = await runPS('Remove-ItemProperty -Path ' + q(APPROVED) + ' -Name ' + q(rev.name) + ' -ErrorAction SilentlyContinue', 20000);
      return { ok: true, detail: '已恢复（标记删除，回到默认启动）' };
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
      const uri = (target && target.uri) || 'ms-settings:';
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
  { action: 'disable_startup', desc: '关掉一个开机自启项（仅当前用户，可撤销）', params: { name: '自启项名字，必须原样来自 startup 列表', source: '该自启项的 source 字段' } },
  { action: 'uninstall_app', desc: '用 winget 卸载一个软件，并记下 id 以便重装', params: { name: '软件全名，必须原样来自软件列表' } },
  { action: 'open_settings', desc: '不执行，只把 Windows 设置页打开给用户自己点（L2 的替代）', params: { uri: '如 ms-settings:windowsdefender' } },
];
