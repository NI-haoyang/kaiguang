import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFindings } from './lib/analyze.mjs';
import { ACTIONS } from './lib/actions.mjs';
import * as journal from './lib/journal.mjs';
import { aiOn, aiStep, localStep, normalizeCards } from './lib/llm.mjs';
import * as settings from './lib/settings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const UI = path.join(HERE, 'ui');
// 缓存与采集中间文件放本机用户目录，安装目录可能只读（打包后 resources\app 不该被写）
const DATA = path.join(process.env.LOCALAPPDATA || path.join(HERE, 'data'), 'Kaiguang', 'data');
const CACHE = path.join(DATA, 'last-report.json');

// 本地服务只给自己的页面用。每次启动生成一次性 token，随 index.html 下发；
// 别的网页读不到我们的 HTML（没有 CORS），也就拿不到 token。
const TOKEN = crypto.randomBytes(18).toString('hex');
let ORIGINS = new Set();

function tokenOk(req) {
  const t = req.headers['x-kg-token'];
  if (typeof t !== 'string' || t.length !== TOKEN.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN)); } catch { return false; }
}
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true;               // 同源 GET 通常不带 Origin
  return ORIGINS.has(o);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const S = { report: null, analysis: null, step: 0, facts: {}, history: [], scan: { running: false, lines: [], error: null } };

function loadCache() {
  try {
    const r = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    S.report = r; S.analysis = buildFindings(r);
    return true;
  } catch { return false; }
}
function saveCache(r) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(r), 'utf8'); } catch {}
}

function scan() {
  if (S.scan.running) return;
  S.scan = { running: true, lines: [], error: null };
  fs.mkdirSync(DATA, { recursive: true });
  const out = path.join(DATA, 'report.json');
  const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'collect.ps1'), '-Out', out], { windowsHide: true });
  const onData = (b) => {
    for (const line of b.toString('utf8').split(/\r?\n/)) {
      const m = line.match(/##step\s+(.+)/);
      if (m) S.scan.lines.push(m[1].trim());
    }
  };
  ps.stdout.on('data', onData);
  ps.stderr.on('data', () => {});
  ps.on('close', (code) => {
    try {
      const r = JSON.parse(fs.readFileSync(out, 'utf8'));
      S.report = r; S.analysis = buildFindings(r); saveCache(r);
      S.step = 0; S.facts = {}; S.history = [];
    } catch (e) { S.scan.error = '采集失败（' + code + '）：' + e.message; }
    S.scan.running = false;
  });
}

const json = (res, obj, code = 200) => {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length });
  res.end(b);
};
const readBody = (req) => new Promise((resolve) => {
  let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
});

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '/index.html') p = '/index.html';
  const fp = path.join(UI, p);
  if (!fp.startsWith(UI) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let b = fs.readFileSync(fp);
  if (p === '/index.html') {
    b = Buffer.from(b.toString('utf8').replace('</head>', '<script>window.KG_TOKEN="' + TOKEN + '"</script></head>'), 'utf8');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(b);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    if (!tokenOk(req)) return json(res, { detail: '页面和程序对不上，重启一次就好。' }, 401);
    if (!originOk(req)) return json(res, { detail: '只接受本机页面发来的请求。' }, 403);
    if (req.method === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
      return json(res, { detail: '请求格式不对，需要 application/json。' }, 415);
    }
  }

  if (p === '/api/state') return json(res, {
    ai: aiOn(), scanning: S.scan.running,
    ready: !!S.report,
    report: S.report, analysis: S.analysis ? { score: S.analysis.score, findings: S.analysis.findings, counts: S.analysis.counts, verify: S.analysis.verify, metrics: S.analysis.metrics } : null,
    journal: journal.list(),
  });

  if (p === '/api/scan' && req.method === 'POST') { scan(); return json(res, { ok: true }); }
  if (p === '/api/scan/status') return json(res, { running: S.scan.running, lines: S.scan.lines, error: S.scan.error, ready: !!S.report });

  if (p === '/api/chat' && req.method === 'POST') {
    const { text } = await readBody(req);
    if (!S.report) return json(res, { error: '还没体检' }, 400);
    if (text) { S.history.push({ role: 'user', text }); }

    if (S.step >= 1 && text) {
      if (/wps/i.test(text)) S.facts.office = 'wps';
      else if (/office|365/i.test(text)) S.facts.office = 'office';
    }

    let out;
    if (aiOn()) {
      try { out = await aiStep({ step: S.step, facts: S.facts }, S.report, S.analysis, S.history); }
      catch (e) { out = localStep({ step: S.step, facts: S.facts }, S.report, S.analysis); out.say = '（AI 没连上，先用本地规则给你结论）\n' + out.say; }
    } else {
      out = localStep({ step: S.step, facts: S.facts }, S.report, S.analysis);
    }
    if (out.cards) out.cards = normalizeCards(out.cards, S.report);
    S.history.push({ role: 'ai', text: out.say, cards: out.cards || null, ask: out.ask || null });
    S.step = out.cards ? 99 : S.step + 1;
    return json(res, out);
  }

  if (p === '/api/execute' && req.method === 'POST') {
    const { card } = await readBody(req);
    const def = ACTIONS[card && card.action];
    if (!def) return json(res, { ok: false, detail: '不认识的动作' }, 400);

    // 目标必须来自这次体检的结果：名字对不上就不动，来源（HKCU/HKLM）也以报告为准，
    // 免得前端把一条 HKCU 项谎报成 HKLM（或其他方向）而走错注册表根。
    if (card.action === 'disable_startup' || card.action === 'uninstall_app') {
      const want = card.target && card.target.name;
      const list = card.action === 'disable_startup'
        ? ((S.report && S.report.startup) || [])
        : ((S.report && S.report.apps) || []);
      const hit = list.find((x) => x.name === want);
      if (!hit) return json(res, { ok: false, detail: '这条不在本次体检结果里，我不动。请先重新体检。' }, 400);
      card.target = card.action === 'disable_startup'
        ? { name: hit.name, source: hit.source }
        : { name: hit.name };
    }
    const t0 = Date.now();
    let chk = { ok: true };
    if (def.check) { try { chk = await def.check(card.target || {}); } catch (e) { chk = { ok: false, reason: e.message }; } }
    if (!chk.ok) {
      const entry = journal.append({ action: card.action, title: card.title, target: card.target, ok: false, needsAdmin: !!chk.needsAdmin, detail: chk.reason, revert: null });
      return json(res, { ok: false, detail: chk.reason, needsAdmin: !!chk.needsAdmin, ms: Date.now() - t0, entry });
    }
    let r;
    try { r = await def.run(card.target || {}); } catch (e) { r = { ok: false, detail: e.message }; }
    const entry = journal.append({ action: card.action, title: card.title, target: card.target, ok: !!r.ok, detail: r.detail || '', revert: r.revert || null });
    return json(res, { ok: !!r.ok, detail: r.detail || '', ms: Date.now() - t0, entry });
  }

  if (p === '/api/undo' && req.method === 'POST') {
    const { id } = await readBody(req);
    const entry = journal.list().find(e => e.id === id);
    if (!entry || !entry.revert) return json(res, { ok: false, detail: '这条没有可撤销的记录' }, 400);
    const def = ACTIONS[entry.action];
    if (!def || !def.revert) return json(res, { ok: false, detail: '这个动作没有撤销实现' }, 400);
    const t0 = Date.now();
    const r = await def.revert(entry.revert);
    if (r.ok) journal.update(id, { undone: true, undoneAt: Date.now() });
    return json(res, { ok: r.ok, detail: r.detail, ms: Date.now() - t0 });
  }

  if (p === '/api/open' && req.method === 'POST') {
    const { uri } = await readBody(req);
    const safe = /^ms-settings:[a-z0-9]*$/i.test(uri || '') ? uri : 'ms-settings:';
    spawn('cmd', ['/c', 'start', '', safe], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    return json(res, { ok: true, uri: safe });
  }

  if (p === '/api/settings') {
    if (req.method === 'GET') return json(res, { hasKey: aiOn(), model: settings.model(), file: settings.where() });
    const body = await readBody(req);
    const key = String(body.key || '').trim();
    if (!key) return json(res, { ok: false, detail: '没有拿到 key' }, 400);
    settings.save({ apiKey: key });
    return json(res, { ok: true, hasKey: aiOn(), model: settings.model() });
  }

  if (p === '/api/journal') return json(res, { entries: journal.list() });

  if (req.method === 'GET') return serveStatic(req, res, url);
  res.writeHead(404); res.end('not found');
}

export function start(port = 0) {
  loadCache();
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => { handle(req, res).catch(e => { try { json(res, { error: e.message }, 500); } catch {} }); });
    server.listen(port, '127.0.0.1', () => {
      const got = server.address().port;
      ORIGINS = new Set(['http://127.0.0.1:' + got, 'http://localhost:' + got]);
      resolve({ server, port: got, close: () => server.close() });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const argPort = process.argv.indexOf('--port');
  const port = Number(process.env.PORT || (argPort > 0 ? process.argv[argPort + 1] : 0));
  start(port).then(({ port }) => {
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('开机第一天 · Agent 版');
    console.log('  ' + url);
    console.log('  AI：' + (aiOn() ? '已启用 (' + (process.env.LLM_MODEL || 'deepseek-flash') + ')' : '未启用（没有 DEEPSEEK_API_KEY，本地规则接管）'));
    if (process.argv.includes('--open')) spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  });
}