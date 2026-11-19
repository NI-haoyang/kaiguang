if (window.kgDesktop) document.body.classList.add('desktop');
const $ = (s) => document.querySelector(s);
const STEPS = ['读系统与硬件', '看磁盘空间', '数一遍装了多少软件', '检查开机自启', '看后台服务', '查防火墙和防护状态', '验机：电池、硬盘、安装天数', '整理成报告'];

const S = { report: null, analysis: null, journal: [], cards: [], picked: new Set(), busy: false };

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function api(path, body) {
  // 本地服务只认自己页面下发的 token（页面里由服务端注入 window.KG_TOKEN）
  const headers = { 'Content-Type': 'application/json' };
  if (window.KG_TOKEN) headers['X-KG-Token'] = window.KG_TOKEN;
  const r = await fetch(path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.error || ('HTTP ' + r.status));
  return j;
}

/* ---------------- 左栏 ---------------- */
function renderLeft() {
  const a = S.analysis;
  if (!a) return;
  $('#score').textContent = a.score;
  $('#scoreVerdictTag').textContent = a.score >= 80 ? '基本干净' : a.score >= 60 ? '有几处要动手' : '问题偏多';
  $('#scoreNote').textContent = a.counts.high ? '有 ' + a.counts.high + ' 处「要处理」，其余是可选。' : '没有硬伤，剩下的都是可选项。';

  const m = $('#metrics');
  m.innerHTML = '';
  const rows = [
    ['C: 盘剩余', a.metrics.freePct != null ? a.metrics.freePct + '%' : '—'],
    ['开机自启', (S.report.counts.startup) + ' 个'],
    ['第三方服务', (S.report.counts.services) + ' 个'],
    ['已装软件', S.report.counts.apps + ' 个'],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'metric');
    r.append(el('span', null, k), el('b', null, v));
    m.append(r);
  }

  const v = a.verify;
  const box = $('#verify');
  box.className = 'verify ' + (v.tone || '');
  box.innerHTML = '';
  box.append(el('b', null, v.title), el('p', null, v.detail));

  $('#pillScan').textContent = '已体检';
  $('#pillScan').classList.add('on');

  renderReport();
}

const LEVEL_TXT = { high: '要处理', warn: '建议看看', info: '知道就行', ok: '没问题' };
const LEVEL_ORDER = { high: 0, warn: 1, info: 2, ok: 3 };

// 左侧体检报告：跟网页版一样的逐条卡片——为什么、怎么办、涉及哪些东西
function renderReport() {
  const a = S.analysis;
  const box = $('#report');
  if (!a || !box) return;
  box.innerHTML = '';
  $('#reportCount').textContent = a.counts.high
    ? a.findings.length + ' 条 · ' + a.counts.high + ' 处要处理'
    : a.findings.length + ' 条 · 没有硬伤';

  const list = a.findings.slice().sort((x, y) => (LEVEL_ORDER[x.level] ?? 9) - (LEVEL_ORDER[y.level] ?? 9));
  if (!list.length) { box.append(el('p', 'muted', '没有发现需要处理的问题。')); return; }

  for (const f of list) {
    const c = el('article', 'fcard ' + (f.level || 'info'));
    const head = el('div', 'fhead');
    head.append(el('h3', null, f.title), el('span', 'flevel', LEVEL_TXT[f.level] || '记录'));
    c.append(head);
    if (f.detail) c.append(el('p', 'fdetail', f.detail));
    if (f.fix) {
      const p = el('p', 'ffix');
      p.append(el('b', null, '→ '), document.createTextNode(f.fix));
      c.append(p);
    }
    if (f.items && f.items.length) {
      const wrap = el('div', 'fitems');
      for (const t of f.items.slice(0, 8)) wrap.append(el('span', 'fitem', t));
      if (f.items.length > 8) wrap.append(el('span', 'fitem', '+' + (f.items.length - 8) + ' 个'));
      c.append(wrap);
    }
    if (f.action === 'open_settings') {
      const label = f.cta || '打开设置页';
      const btn = el('button', 'linkbtn', label);
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = '正在打开…';
        try {
          await api('/api/execute', { card: { action: 'open_settings', title: f.title, target: f.args || {} } });
          btn.textContent = '✓ 已打开';
          S.journal = (await api('/api/journal')).entries;
          renderLog();
        } catch (e) { btn.textContent = '打开失败'; }
        setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 3500);
      };
      c.append(btn);
    }
    box.append(c);
  }
}

const ACTION_LABEL = { disable_startup: '关掉开机自启', uninstall_app: '卸载软件', open_settings: '打开设置页' };

function renderLog() {
  const box = $('#log');
  box.innerHTML = '';
  if (!S.journal.length) { box.append(el('p', 'muted', '还没有执行任何动作。')); $('#logCount').textContent = ''; return; }
  $('#logCount').textContent = S.journal.length + ' 条';
  for (const e of S.journal.slice().reverse()) {
    const box2 = el('div', 'entry ' + (e.ok ? 'ok' : 'bad'));
    const t = new Date(e.ts);
    box2.append(el('div', 't', t.toTimeString().slice(0, 8)));
    const row = el('div', 'n');
    row.append(el('b', null, e.title || ACTION_LABEL[e.action] || e.action));
    if (e.revert && !e.undone) {
      const u = el('span', 'undo', '撤销');
      u.onclick = () => undo(e.id, u);
      row.append(u);
    } else if (e.undone) row.append(el('span', 'undone', '已撤销'));
    box2.append(row, el('div', 'd', e.detail || ''));
    box.append(box2);
  }
  const orig = $('#orig');
  orig.innerHTML = '';
  for (const e of S.journal) {
    if (e.revert && e.revert.kind === 'reg') orig.append(el('div', 'o', e.revert.name + ' → ' + e.revert.value));
  }
  $('#origNote').textContent = S.journal.some(e => e.revert) ? '这些是改动前的原值。撤销就是把它们写回去。' : '执行前会先把原值记下来。撤销就是把原值写回去。';
}

/* ---------------- 对话 ---------------- */
function scroll() { const t = $('#thread'); t.scrollTop = t.scrollHeight; }

function bubble(role, text) {
  const m = el('div', 'msg ' + (role === 'user' ? 'user' : ''));
  m.append(el('div', 'av', role === 'user' ? '你' : '开'));
  const b = el('div', 'body', text);
  m.append(b);
  $('#thread').append(m);
  scroll();
  return m;
}

function chips(list, onClick) {
  const box = el('div', 'opts');
  for (const c of list) {
    const o = el('span', 'opt', c);
    o.onclick = () => { box.remove(); onClick(c); };
    box.append(o);
  }
  return box;
}

function send(text) {
  if (S.busy || !text.trim()) return;
  $('#input').value = '';
  bubble('user', text);
  S.busy = true;
  api('/api/chat', { text }).then(out => {
    const m = bubble('ai', out.say);
    if (out.ask) m.querySelector('.body').append(chips(out.ask.chips || ['好', '不用了'], send));
    if (out.cards) renderCards(out.cards);
  }).catch(e => bubble('ai', '出错了：' + e.message)).finally(() => { S.busy = false; });
}

/* ---------------- 卡片 ---------------- */
function renderCards(cards) {
  S.cards = cards; S.picked = new Set();
  const wrap = el('div', 'cards');
  if (!cards.length) {
    wrap.append(el('p', 'muted', '按你的数据，没有值得动的地方。'));
    $('#thread').append(wrap); scroll(); return;
  }
  cards.forEach((c, i) => {
    const isLink = c.action === 'open_settings';
    const box = el('div', 'card' + (isLink ? ' link' : '') + (isLink ? '' : ' pick'));
    const row = el('div', 'row');
    if (!isLink) {
      const pick = el('div', 'box');
      pick.onclick = () => {
        if (S.picked.has(i)) { S.picked.delete(i); box.classList.remove('pick'); }
        else { S.picked.add(i); box.classList.add('pick'); }
        syncBar();
      };
      S.picked.add(i);
      row.append(pick);
    }
    const main = el('div');
    main.append(el('h3', null, c.title), el('p', null, c.why));
    const meta = el('div', 'meta');
    meta.append(el('span', 'badge ' + (isLink ? 'warn' : 'rev'), c.badge));
    if (!isLink) meta.append(el('span', 'badge', c.needAdmin ? '要你点一次 UAC' : '不需要管理员'));
    main.append(meta);
    if (isLink) {
      const b = el('button', 'linkbtn', '打开设置页');
      b.onclick = () => api('/api/open', { uri: c.target.uri }).then(() => {
        b.textContent = '已打开'; b.disabled = true;
        S.journal.unshift({ id: 'local' + Date.now(), ts: Date.now(), action: 'open_settings', title: c.title, ok: true, detail: '设置页已打开，等你点完', revert: null });
        renderLog();
      });
      main.append(b);
    }
    row.append(main);
    box.append(row);
    wrap.append(box);
    c._el = box;
  });

  const bar = el('div', 'actionbar');
  bar.id = 'bar';
  const go = el('button', 'btn primary', '执行选中的 0 项');
  go.id = 'go';
  go.onclick = executeSelected;
  bar.append(go);
  wrap.append(bar);
  $('#thread').append(wrap);
  scroll();
  syncBar();
}

function syncBar() {
  const go = $('#go');
  if (!go) return;
  go.textContent = '执行选中的 ' + S.picked.size + ' 项';
  go.disabled = S.picked.size === 0;
}

async function executeSelected() {
  if (S.busy) return;
  S.busy = true;
  const go = $('#go');
  go.disabled = true;
  const list = [...S.picked].map(i => S.cards[i]).filter(Boolean);
  let ok = 0, bad = 0;
  for (const c of list) {
    const box = c._el;
    const st = el('div', 'status');
    st.innerHTML = '<span class="spin"></span>执行中…';
    box.append(st);
    try {
      const r = await api('/api/execute', { card: { action: c.action, target: c.target, title: c.title } });
      box.classList.remove('fail', 'pick');
      box.classList.add(r.ok ? 'done' : 'fail');
      st.className = 'status ' + (r.ok ? 'ok' : 'err');
      st.textContent = (r.ok ? '✓ ' : '✕ ') + (r.detail || '') + '  ·  ' + (r.ms / 1000).toFixed(1) + 's' + (r.entry && r.entry.revert ? '  · 可撤销' : '');
      if (r.entry) S.journal.push(r.entry);
      r.ok ? ok++ : bad++;
      renderLog();
    } catch (e) {
      st.className = 'status err';
      st.textContent = '✕ ' + e.message;
      box.classList.add('fail');
      bad++;
      if (bad >= 1) { /* 失败即停 */ break; }
    }
  }
  S.busy = false;
  go.textContent = '完成 ' + ok + ' 条' + (bad ? '，' + bad + ' 条没成功' : '');
  go.disabled = true;

  const done = S.journal.filter(e => e.revert && !e.undone);
  if (done.length) {
    const bar = $('#bar');
    const undoAll = el('button', 'btn ghost', '全部撤销（' + done.length + '）');
    undoAll.onclick = async () => {
      undoAll.disabled = true;
      undoAll.textContent = '正在撤销…';
      for (const e of done.slice().reverse()) {
        try { await api('/api/undo', { id: e.id }); } catch (x) {}
      }
      S.journal = (await api('/api/journal')).entries;
      renderLog();
      document.querySelectorAll('.card.done').forEach((box) => {
        box.classList.remove('done');
        const st = box.querySelector('.status');
        if (st) { st.className = 'status ok'; st.textContent = '↩ 已撤销，恢复原样'; }
      });
      undoAll.textContent = '已全部恢复';
      bubble('ai', '都退回去了，跟执行之前一样。这就是「做错的代价是三秒」。');
    };
    bar.append(undoAll);
  }
}

async function undo(id, btn) {
  btn.textContent = '…';
  try {
    const r = await api('/api/undo', { id });
    S.journal = (await api('/api/journal')).entries;
    renderLog();
    bubble('ai', '「' + (r.detail || '已恢复') + '」——这一条退回去了。');
  } catch (e) { btn.textContent = '撤销'; alert(e.message); }
}

/* ---------------- 体检流程 ---------------- */
function showScan() {
  const t = $('#thread');
  t.innerHTML = '';
  const box = el('div', 'scan');
  box.append(el('h2', null, '正在读这台机器'), el('p', 'muted', '只读采集，不改任何设置，不上传任何数据。'));
  const steps = el('div', 'steps');
  const refs = STEPS.map(s => {
    const d = el('div', 'step');
    d.append(el('div', 'dot'), el('span', null, s));
    steps.append(d);
    return d;
  });
  box.append(steps);
  t.append(box);
}

async function scanNow() {
  showScan();
  await api('/api/scan', {});
  const refs = [...document.querySelectorAll('.step')];
  const t = setInterval(async () => {
    const s = await api('/api/scan/status');
    const n = s.lines.length;
    refs.forEach((r, i) => { r.className = 'step' + (i < n ? ' ok' : i === n ? ' on' : ''); });
    if (!s.running) {
      clearInterval(t);
      refs.forEach(r => r.className = 'step ok');
      if (s.error) { bubble('ai', '体检没跑完：' + s.error); return; }
      const st = await api('/api/state');
      S.report = st.report; S.analysis = st.analysis; S.journal = st.journal || [];
      renderLeft(); renderLog();
      $('#thread').innerHTML = '';
      greet();
    }
  }, 400);
}

function emptyState() {
  const t = $('#thread');
  t.innerHTML = '';
  const box = el('div', 'empty');
  box.append(el('h2', null, '先给这台电脑做个体检'));
  box.append(el('p', null, '我会读一遍硬件、装了哪些软件、开机自启、后台服务和安全状态。大约 20 秒，只读，不联网。'));
  const b = el('button', 'btn primary big', '开始体检');
  b.onclick = scanNow;
  box.append(b);
  t.append(box);
}

async function greet() {
  const out = await api('/api/chat', { text: '' });
  const m = bubble('ai', out.say);
  if (out.ask) m.querySelector('.body').append(chips(out.ask.chips || [], send));
  if (out.cards) renderCards(out.cards);
}

async function boot() {
  const st = await api('/api/state');
  S.ai = !!st.ai; S.model = st.model;
  $('#pillAI').textContent = st.ai ? 'AI 已连接' : '本地规则';
  $('#pillAI').classList.toggle('on', !!st.ai);
  if (st.ready) {
    S.report = st.report; S.analysis = st.analysis; S.journal = st.journal || [];
    renderLeft(); renderLog();
    if (st.scanning) { showScan(); return scanNow(); }
    // 有缓存：直接进对话
    const last = S.journal.length;
    greet();
  } else {
    // 第一次打开：不等用户点，直接开始体检（双击到出报告 20 秒）
    emptyState();
    setTimeout(scanNow, 700);
  }
}

$('#pillAI').style.cursor = 'pointer';
$('#pillAI').title = '点一下填 DeepSeek API Key（只存本机）';
$('#pillAI').onclick = async () => {
  if (S.ai) { bubble('ai', 'AI 已经连着了，用的是 ' + (S.model || 'deepseek-flash') + '。想换 key 就删掉 %LOCALAPPDATA%\\Kaiguang\\settings.json 里的 apiKey，再点这里。'); return; }
  const k = prompt('粘贴 DeepSeek API Key。\n只写进本机 %LOCALAPPDATA%\\Kaiguang\\settings.json，不会上传，也不会写进报告。');
  if (!k || !k.trim()) return;
  const r = await api('/api/settings', { key: k.trim() });
  if (r && r.ok) {
    S.ai = true; S.model = r.model;
    $('#pillAI').textContent = 'AI 已连接';
    $('#pillAI').classList.add('on');
    bubble('ai', '连上了。接下来按你这台机器的真实数据说话，不再走本地规则。');
  } else {
    bubble('ai', '这个 key 没存进去，再试一次。');
  }
};

$('#send').onclick = () => send($('#input').value);
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter') send($('#input').value); });

boot().catch(e => { document.body.append(el('p', null, '启动失败：' + e.message)); });