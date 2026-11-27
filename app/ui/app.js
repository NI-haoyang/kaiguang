if (window.kgDesktop) document.body.classList.add('desktop');
const $ = (s) => document.querySelector(s);
const STEPS = ['读系统与硬件', '看磁盘空间', '数一遍装了多少软件', '检查开机自启', '看后台服务', '查防火墙和防护状态', '验机：电池、硬盘、安装天数', '整理成报告'];

const S = { report: null, analysis: null, journal: [], cards: [], picked: new Set(), busy: false, apps: [], appPicked: new Set(), appsBusy: false, disk: null, diskBusy: false };

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

const ACTION_LABEL = { disable_startup: '关掉开机自启', uninstall_app: '卸载软件', install_app: '安装软件', open_settings: '打开设置页' };

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
  m.append(el('div', 'av', role === 'user' ? '你' : '小'));
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
  const pending = bubble('ai', '正在想…');
  pending.classList.add('pending');
  api('/api/chat', { text }).then(out => {
    pending.remove();
    const m = bubble('ai', out.say);
    if (out.ask) m.querySelector('.body').append(chips(out.ask.chips || [], send));
    if (out.clear) {
      document.querySelectorAll('#thread .cards').forEach(n => n.remove());
      S.cards = []; S.picked = new Set();
    }
    if (out.cards) renderCards(out.cards, !out.keepPrev);
  }).catch(e => { pending.remove(); bubble('ai', '出错了：' + e.message); }).finally(() => { S.busy = false; });
}

/* ---------------- 卡片 ---------------- */
function renderCards(cards, replace = true) {
  // 重新规划时替换上一组；问答里补的单条动作另起一组，不覆盖原清单
  if (replace) document.querySelectorAll('#thread .cards').forEach(n => n.remove());
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
      row.append(el('div', 'box'));
      S.picked.add(i);
      // 整张卡片都能点，不用非得戳那个小方块
      box.onclick = (e) => {
        if (e.target.closest('button, a')) return;
        if (S.picked.has(i)) { S.picked.delete(i); box.classList.remove('pick'); }
        else { S.picked.add(i); box.classList.add('pick'); }
        syncBar();
      };
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
  // 多组卡片时只让最新那个按钮持有 #go，旧的留在屏幕上但不再被选中
  document.querySelectorAll('#go').forEach(n => n.removeAttribute('id'));
  const go = el('button', 'btn primary', '执行选中的 0 项');
  go.id = 'go';
  go.onclick = executeSelected;
  S.goEl = go;
  bar.append(go, el('span', 'hint', '点卡片任意位置都能勾选 / 取消'));
  wrap.append(bar);
  $('#thread').append(wrap);
  scroll();
  syncBar();
}

function syncBar() {
  const go = S.goEl;
  if (!go) return;
  go.textContent = '执行选中的 ' + S.picked.size + ' 项';
  go.disabled = S.picked.size === 0;
}

async function executeSelected() {
  if (S.busy) return;
  S.busy = true;
  const go = S.goEl;
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
    const bar = S.goEl.parentElement;
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

/* ---------------- 装软件 ---------------- */
async function openApps() {
  if (!S.report) { bubble('ai', '先让体检跑完，我再按这台机器的已装清单给你列。'); return; }
  $('#appsModal').hidden = false;
  const box = $('#appsList');
  box.innerHTML = '<p class="muted">读取装机清单…</p>';
  $('#appsStatus').textContent = '';
  try {
    const r = await api('/api/catalog');
    S.apps = r.apps || [];
    S.appPicked = new Set();
    renderApps();
  } catch (e) {
    box.innerHTML = '';
    box.append(el('p', 'muted', '清单没读到：' + e.message));
  }
}

function renderApps() {
  const box = $('#appsList');
  box.innerHTML = '';
  for (const app of S.apps) {
    const row = el('label', 'app-row' + (app.installed ? ' on' : '') + (app.lastError ? ' bad' : ''));
    row.dataset.app = app.id;
    const cb = el('input');
    cb.type = 'checkbox';
    cb.disabled = !!app.installed;
    cb.checked = S.appPicked.has(app.id);
    cb.onchange = () => {
      if (cb.checked) S.appPicked.add(app.id); else S.appPicked.delete(app.id);
      syncApps();
    };
    row.append(cb);
    const main = el('div', 'app-main');
    const nm = el('div', 'app-name');
    nm.append(el('span', null, app.name), el('span', 'app-tag', app.tag || ''));
    main.append(nm, el('p', null, app.desc || ''));
    row.append(main);
    row.append(el('span', 'app-state', app.installed ? '已装' : (app.lastError || '')));
    box.append(row);
  }
  syncApps();
}

function syncApps() {
  const btn = $('#appsInstall');
  if (!btn) return;
  btn.textContent = '安装选中的 ' + S.appPicked.size + ' 个';
  btn.disabled = S.appsBusy || S.appPicked.size === 0;
  const installed = S.apps.filter(a => a.installed).length;
  if (!S.appsBusy && !S.apps.length) $('#appsStatus').textContent = '';
  else if (!S.appsBusy) $('#appsStatus').textContent = installed + ' 个已装 · 勾选 ' + S.appPicked.size + ' 个';
}

async function installApps() {
  if (S.appsBusy || !S.appPicked.size) return;
  S.appsBusy = true;
  syncApps();
  const ids = [...S.appPicked];
  let ok = 0, bad = 0, last = '';
  for (const id of ids) {
    const app = S.apps.find(a => a.id === id);
    if (!app) continue;
    const row = document.querySelector('.app-row[data-app="' + id + '"]');
    if (row) { const st = row.querySelector('.app-state'); if (st) st.textContent = '安装中…'; }
    try {
      const r = await api('/api/execute', { card: { action: 'install_app', target: { id: app.id, name: app.name }, title: '安装 ' + app.name } });
      if (r.entry) S.journal.push(r.entry);
      if (r.ok) { app.installed = true; app.lastError = ''; ok++; if (row) row.classList.add('on'); }
      else { app.lastError = '✕ ' + (r.detail || '失败'); last = app.lastError; bad++; if (row) { row.classList.add('bad'); const st = row.querySelector('.app-state'); if (st) st.textContent = app.lastError; } }
      renderLog();
    } catch (e) {
      app.lastError = '✕ ' + e.message; last = app.lastError; bad++;
      if (row) { row.classList.add('bad'); const st = row.querySelector('.app-state'); if (st) st.textContent = app.lastError; }
    }
    if (bad) break; // 失败即停，和动作执行保持一致
  }
  S.appsBusy = false;
  S.appPicked = new Set();
  renderApps();
  if (bad) $('#appsStatus').textContent = '停了：' + last;
  else $('#appsStatus').textContent = '完成 ' + ok + ' 个，可在右侧日志里撤销';
  if (ok) bubble('ai', '装好了 ' + ok + ' 个。想退就点右边日志里的「撤销」——装完的撤销就是把它卸掉。');
}

function closeApps() { $('#appsModal').hidden = true; }

/* ---------------- 磁盘空间（只读） ---------------- */
function fmtSize(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
  if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + ' MB';
  return Math.max(0, Math.round(n / 1024)) + ' KB';
}

async function openDisk() {
  if (!S.report) { bubble('ai', '先让体检跑完，我再扫磁盘；不然不知道 C 盘现在是什么状况。'); return; }
  $('#diskModal').hidden = false;
  if (S.disk && Date.now() - S.disk.at < 60000) { renderDisk(S.disk); return; }
  await scanDiskUI();
}

async function scanDiskUI(force = false) {
  if (S.diskBusy) return;
  S.diskBusy = true;
  const box = $('#diskBody');
  const btn = $('#diskRefresh');
  box.innerHTML = '';
  box.append(el('p', 'muted', '正在扫 C / D 盘…只读，不删任何文件。大概几秒。'));
  btn.disabled = true; btn.textContent = '扫描中…';
  try {
    const d = await api('/api/disk' + (force ? '?refresh=1' : ''));
    S.disk = d;
    renderDisk(d);
  } catch (e) {
    box.innerHTML = '';
    box.append(el('p', 'muted', '扫描没完成：' + e.message));
  } finally {
    S.diskBusy = false;
    btn.disabled = false; btn.textContent = '重新扫描';
  }
}

function renderDisk(d) {
  const box = $('#diskBody');
  if (!d) return;
  box.innerHTML = '';
  const drives = el('div', 'disk-drives');
  for (const dr of d.drives || []) {
    const card = el('div', 'drive');
    const top = el('div', 'drive-top');
    top.append(el('b', null, dr.letter + ':'));
    if (!dr.exists) {
      top.append(el('span', null, '没有这个盘'));
      card.append(top);
      drives.append(card);
      continue;
    }
    if (dr.error) {
      top.append(el('span', null, dr.error));
      card.append(top);
      drives.append(card);
      continue;
    }
    top.append(el('span', null, fmtSize(dr.free) + ' 可用 / ' + fmtSize(dr.total)));
    const usedPct = dr.total ? Math.min(100, Math.max(0, dr.used / dr.total * 100)) : 0;
    const freePct = 100 - usedPct;
    const bar = el('div', 'drive-bar');
    const fill = el('i');
    fill.style.width = usedPct.toFixed(1) + '%';
    if (freePct < 10) fill.className = 'bad'; else if (freePct < 20) fill.className = 'warn';
    bar.append(fill);
    const bottom = el('div', 'drive-bottom');
    bottom.append(el('span', null, '已用 ' + usedPct.toFixed(0) + '%'), el('span', null, '剩 ' + freePct.toFixed(0) + '%'));
    card.append(top, bar, bottom);
    drives.append(card);
  }
  box.append(drives);

  const clean = (d.clean || []).filter(x => x.exists && (x.bytes > 0 || x.note));
  const sec1 = el('div', 'disk-sec');
  const h1 = el('h3');
  h1.append(document.createTextNode('可以先清的缓存 / 临时文件'), el('span', null, d.cleanupBytes ? '约 ' + fmtSize(d.cleanupBytes) : ''));
  sec1.append(h1);
  if (!clean.length) sec1.append(el('p', 'disk-note', '没找到可清的缓存。'));
  else {
    const list = el('div', 'disk-list');
    for (const x of clean) {
      const row = el('div', 'disk-row');
      const main = el('div', 'dr-main');
      main.append(el('b', null, x.label));
      if (x.note) main.append(el('small', null, x.note));
      const size = el('span', 'dr-size');
      size.append(document.createTextNode(x.bytes > 0 ? fmtSize(x.bytes) : '—'));
      if (x.truncated) size.append(el('em', null, '至少'));
      row.append(main, size);
      list.append(row);
    }
    sec1.append(list);
  }
  box.append(sec1);

  const dirs = (d.dirs || []).filter(x => x.bytes > 0);
  if (dirs.length) {
    const sec2 = el('div', 'disk-sec');
    sec2.append(el('h3', null, '占地方最多的目录'));
    const list = el('div', 'disk-list');
    for (const x of dirs) {
      const row = el('div', 'disk-row');
      const main = el('div', 'dr-main');
      main.append(el('b', null, x.name), el('small', null, x.path));
      const size = el('span', 'dr-size');
      size.append(document.createTextNode(fmtSize(x.bytes)));
      if (x.truncated) size.append(el('em', null, '至少'));
      row.append(main, size);
      list.append(row);
    }
    sec2.append(list, el('p', 'disk-note', '标「至少」的是扫描上限截断后的下限，不是精确值。'));
    box.append(sec2);
  }

  const files = d.files || [];
  if (files.length) {
    const sec3 = el('div', 'disk-sec');
    sec3.append(el('h3', null, '大文件（只扫用户目录）'));
    const list = el('div', 'disk-list');
    for (const f of files) {
      const row = el('div', 'disk-row');
      const main = el('div', 'dr-main');
      const parent = f.path.slice(0, Math.max(0, f.path.length - f.name.length - 1));
      main.append(el('b', null, f.name), el('small', null, parent));
      row.append(main, el('span', 'dr-size', fmtSize(f.bytes)));
      list.append(row);
    }
    sec3.append(list, el('p', 'disk-note', 'D 盘看上面的目录占用；这里不删任何东西。'));
    box.append(sec3);
  }

  if (d.notes && d.notes.length) {
    const note = el('div', 'disk-note');
    for (const n of d.notes) note.append(el('div', null, '· ' + n));
    box.append(note);
  }

  const c = (d.drives || []).find(x => x.letter === 'C' && x.exists && !x.error);
  if (c) $('#diskHint').textContent = 'C 剩 ' + Math.round(c.free / c.total * 100) + '%' + (d.cleanupBytes ? ' · 可清约 ' + fmtSize(d.cleanupBytes) : '');
}

function closeDisk() { $('#diskModal').hidden = true; }


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
  const pending = bubble('ai', '正在看这台机器…');
  pending.classList.add('pending');
  const out = await api('/api/chat', { text: '' });
  pending.remove();
  const m = bubble('ai', out.say);
  if (out.ask) m.querySelector('.body').append(chips(out.ask.chips || [], send));
  if (out.clear) document.querySelectorAll('#thread .cards').forEach(n => n.remove());
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

$('#btnApps').onclick = openApps;
$('#appsClose').onclick = closeApps;
$('#appsInstall').onclick = installApps;
$('#appsModal').addEventListener('click', (e) => { if (e.target.id === 'appsModal') closeApps(); });

$('#btnDisk').onclick = openDisk;
$('#diskClose').onclick = closeDisk;
$('#diskRefresh').onclick = () => scanDiskUI(true);
$('#diskSettings').onclick = async () => {
  const b = $('#diskSettings');
  b.disabled = true; b.textContent = '正在打开…';
  try { await api('/api/open', { uri: 'ms-settings:storagesense' }); b.textContent = '已打开'; }
  catch (e) { b.textContent = '打开失败'; }
  setTimeout(() => { b.disabled = false; b.textContent = '打开存储感知'; }, 2500);
};
$('#diskModal').addEventListener('click', (e) => { if (e.target.id === 'diskModal') closeDisk(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#diskModal').hidden) closeDisk();
  else if (!$('#appsModal').hidden) closeApps();
});

$('#send').onclick = () => send($('#input').value);
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter') send($('#input').value); });

boot().catch(e => { document.body.append(el('p', null, '启动失败：' + e.message)); });