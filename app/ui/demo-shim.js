/* 静态演示用的假后端：动作全是模拟的，不碰用户的电脑。由 tools/build-agent-demo.mjs 内联进页面。 */
const DATA = __DATA__;
const STEP_LABELS = ['读系统与硬件','看磁盘空间','数一遍装了多少软件','检查开机自启','看后台服务','查防火墙和防护状态','验机：电池、硬盘、安装天数','整理成报告'];
const SIM = { journal: [], step: 0, lines: [], running: false, reported: false, started: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

function detailOf(action) {
  if (action === 'open_settings') {
    return { ok: true, detail: '真机上会真的弹出系统设置页；这里是静态演示，只记一笔', ms: 300, revert: null };
  }
  if (action === 'disable_startup') {
    return { ok: true, detail: '已关闭（原条目还在注册表里，只是不启动了）', ms: 820, revert: { kind: 'reg', name: 'TX Mascot', value: 'C:\\Program Files\\ASUS\\TXMascot.exe' } };
  }
  return { ok: true, detail: '已卸载，需要时可以装回来', ms: 12400, revert: { kind: 'pkg', id: 'demo-pkg', value: 'winget install --id <演示包>' } };
}

const lastRun = {};
function execCard(card) {
  const key = card.action + '|' + card.title;
  const since = lastRun[key];
  if (since && Date.now() - since < 1500) {
    const dup = SIM.journal.filter((e) => e.action === card.action && e.title === card.title).pop();
    if (dup) return { ok: dup.ok, detail: dup.detail, ms: 120, entry: null };
  }
  lastRun[key] = Date.now();
  const d = detailOf(card.action);
  const entry = { id: 'demo' + (++seq), ts: Date.now(), action: card.action, title: card.title, ok: d.ok, detail: d.detail, revert: d.revert };
  SIM.journal.push(entry);
  return { ok: d.ok, detail: d.detail, ms: d.ms, entry };
}

window.fetch = async (url, opt) => {
  const p = String(url);
  const body = opt && opt.body ? JSON.parse(opt.body) : {};
  const j = (obj) => ({ ok: true, status: 200, json: async () => obj });

  if (p === '/api/state') {
    return j({ ai: false, scanning: SIM.running, ready: SIM.reported, report: SIM.reported ? DATA.report : null, analysis: SIM.reported ? DATA.analysis : null, journal: SIM.journal.slice() });
  }
  if (p === '/api/scan') {
    if (!SIM.running && !SIM.reported) {
      SIM.running = true; SIM.lines = []; SIM.started = Date.now();
      setTimeout(() => { SIM.reported = true; SIM.running = false; }, 2600);
    }
    return j({ ok: true });
  }
  if (p === '/api/scan/status') {
    if (SIM.running) {
      const n = Math.min(STEP_LABELS.length, Math.floor((Date.now() - SIM.started) / 320));
      SIM.lines = STEP_LABELS.slice(0, n);
    }
    return j({ running: SIM.running, lines: SIM.lines, error: null, ready: SIM.reported });
  }
  if (p === '/api/chat') {
    const text = String(body.text || '');
    if (!text) { SIM.step = 1; return j(DATA.greet); }
    if (SIM.step <= 1) { SIM.step = 2; return j(DATA.ask2); }
    if (SIM.step === 2) {
      SIM.step = 3;
      const v = /wps/i.test(text) ? 'wps' : /office|365/i.test(text) ? 'office' : 'keep';
      return j(DATA.variants[v]);
    }
    return j({ say: '静态演示只走到这里。桌面版会接着按你的回答挑动作，而且动手之前先把原值记下来。' });
  }
  if (p === '/api/execute') return j(execCard(body.card || {}));
  if (p === '/api/undo') {
    const e = SIM.journal.find((x) => x.id === body.id);
    if (e) e.undone = true;
    await sleep(180);
    return j({ ok: true, detail: '已恢复原样', ms: 210 });
  }
  if (p === '/api/journal') return j({ entries: SIM.journal.slice() });
  if (p === '/api/open') return j({ ok: true, uri: body.uri });
  if (p === '/api/settings') return j({ ok: true, hasKey: false, model: 'deepseek-flash' });
  return j({});
};

window.addEventListener('load', () => {
  const pill = document.querySelector('#pillAI');
  if (pill) {
    pill.textContent = '静态演示';
    pill.title = '网页上的静态演示：动作是模拟的，不会碰你的电脑。';
    pill.style.cursor = 'default';
    pill.onclick = null;
  }
});
