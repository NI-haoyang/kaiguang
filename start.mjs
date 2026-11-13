/**
 * start.mjs —— 一键启动器
 *
 * 做三件事：
 *   1. 找一个空闲端口，把前端页面挂上去
 *   2. 在后台跑 collect.ps1（只读采集）
 *   3. 采集完成后，自动打开浏览器访问那个端口
 *
 * 用法：
 *   node start.mjs            每次都重新采集
 *   node start.mjs --reuse    复用已有的 report.json（调试用）
 *   PORT=4400 node start.mjs  指定端口
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPORT = join(ROOT, 'report.json');
const REUSE = process.argv.includes('--reuse');
const OPEN = !process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

/* ---------- 一个空闲端口 ---------- */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/* ---------- 跑 collect.ps1 ---------- */
function runCollect() {
  const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = join(ROOT, 'collect.ps1');
  console.log('  [1/3] 正在读这台电脑的信息（只读，不改任何设置）…\n');

  return new Promise((resolve) => {
    const child = spawn(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; & '" + script + "'"], {
      cwd: ROOT,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      console.log('  [超时] 采集超过 120 秒，已中止');
      child.kill();
}, 120000);

    child.stdout.on('data', (d) => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, stderr: String(e) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) console.log('  [失败] 采集脚本退出码 ' + code + '\n' + stderr);
      resolve({ ok: code === 0 && existsSync(REPORT), stderr });
    });
  });
}

/* ---------- 打开浏览器 ---------- */
function openBrowser(url) {
  execFile('cmd', ['/c', 'start', '', url], () => {});
}

/* ---------- 页面 ---------- */
function errorPage(stderr) {
  return '<!doctype html><meta charset="utf-8"><title>采集失败</title>' +
    '<body style="background:#0b0d11;color:#e6edf3;font:15px/1.7 system-ui;padding:60px;max-width:760px;margin:0 auto">' +
    '<h1 style="color:#ff6b6b">采集没跑通</h1>' +
    '<p>把下面这段发给作者，他按行号就能定位：</p>' +
    '<pre style="background:#080b0f;border:1px solid #242b36;border-radius:10px;padding:16px;overflow:auto;font-size:12.5px">' +
    (stderr || '(没有错误输出)').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) +
    '</pre></body>';
}

async function indexWithData() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const data = await readFile(REPORT, 'utf8');
  return html.replace(
    '<script src="app.js"></script>',
    '<script>window.KG_AUTO=' + data + ';</script>\n<script src="app.js"></script>'
  );
}

/* ---------- 主流程 ---------- */
const port = Number(process.env.PORT) || await freePort();
const url = 'http://127.0.0.1:' + port + '/';

console.log('');
console.log('  开机第一天 · 本地版');
console.log('  --------------------------------');

let collectOk = true;
let collectErr = '';

if (REUSE && existsSync(REPORT)) {
  console.log('  [1/3] 复用已有 report.json（--reuse）');
} else {
  const r = await runCollect();
  collectOk = r.ok;
  collectErr = r.stderr;
}

console.log('  [2/3] 启动本地页面：' + url);

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, url).pathname;

    if (path === '/' || path === '/index.html') {
      if (!collectOk) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(errorPage(collectErr));
      }
      const html = await indexWithData();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (path === '/api/report') {
      if (!existsSync(REPORT)) { res.writeHead(404); return res.end('{}'); }
      const data = await readFile(REPORT);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(data);
    }

    const file = join(ROOT, path.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    const buf = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('  [3/3] ' + (OPEN ? '打开浏览器…' : '不自动开浏览器（--no-open）'));
  console.log('');
  if (OPEN) {
    console.log('  页面已经打开。这个黑窗口不要关，关掉页面就打不开了。');
    console.log('  按 Ctrl + C 退出。');
    console.log('');
    openBrowser(url);
  } else {
    console.log('  页面地址：' + url);
    console.log('  按 Ctrl + C 退出。');
    console.log('');
  }
});

process.on('SIGINT', () => {
  console.log('\n  已退出。');
  server.close(() => process.exit(0));
});
