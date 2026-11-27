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
    const text = String(body.text || '').trim();
    if (!text) return j(DATA.greet);
    if (/不用了|都别动|先不动|先别|算了|都不做/.test(text)) return j(DATA.stop);
    if (/就按这个|按这个来|执行吧|开始吧|就这样|定了|可以执行|照这个做/.test(text)) return j({ say: DATA.confirm.say, keepPrev: true });
    const usage = /打游戏|游戏|开黑|网游|联机|3A/.test(text) ? 'game'
      : /剪视频|剪辑|设计|画画|修图|达芬奇|adobe/i.test(text) ? 'create'
      : /写代码|编程|开发|代码|前端|后端|全栈|嵌入式/.test(text) ? 'code'
      : /学习|上课|作业|论文|考研|办公|学生/.test(text) ? 'study' : '';
    if (usage) return j(DATA[usage]);
    // 卡片出来以后可以追问；答案在构建时由真实的本地问答模块算好
    const hit = (DATA.answers || []).find(a => new RegExp(a.re, 'i').test(text));
    if (hit) return j({ say: hit.say, keepPrev: true });
    return j({ say: '静态演示只走到这里。桌面版会接着按你的回答挑动作，而且动手之前先把原值记下来。', keepPrev: true });
  }
  if (p === '/api/execute') return j(execCard(body.card || {}));
  if (p === '/api/undo') {
    const e = SIM.journal.find((x) => x.id === body.id);
    if (e) e.undone = true;
    await sleep(180);
    return j({ ok: true, detail: '已恢复原样', ms: 210 });
  }
  if (p === '/api/live') return j({
    demo: true, at: Date.now(),
    cpu: { model: '演示数据 · 不读取本机', cores: 8, usage: 23, baseGhz: 2.5, ghz: 3.4 },
    mem: { total: 16 * 1024 ** 3, free: 3 * 1024 ** 3, used: 13 * 1024 ** 3, pct: 81 },
    disks: [{ letter: 'C', total: 420 * 1024 ** 3, free: 165 * 1024 ** 3, used: 255 * 1024 ** 3, pct: 61 }, { letter: 'D', total: 308 * 1024 ** 3, free: 256 * 1024 ** 3, used: 52 * 1024 ** 3, pct: 17 }],
    thermal: { c: 48, source: '演示数据' },
    gpu: { name: 'NVIDIA GeForce（演示）', temp: 56, util: 12 },
    probeReady: true, uptime: 3600,
  });
  if (p === '/api/disk') return j({
    at: Date.now(), tookMs: 1800,
    drives: [{ letter: 'C', exists: true, total: 420 * 1024 ** 3, free: 165 * 1024 ** 3, used: 255 * 1024 ** 3 }, { letter: 'D', exists: true, total: 308 * 1024 ** 3, free: 256 * 1024 ** 3, used: 52 * 1024 ** 3 }],
    clean: [
      { key: 'temp', label: '用户临时文件', exists: true, bytes: 850 * 1024 ** 2, truncated: false, note: '' },
      { key: 'wintemp', label: 'Windows 临时文件', exists: true, bytes: 0, truncated: false, note: '部分文件需要管理员权限' },
      { key: 'recycle', label: '回收站（能读到的部分）', exists: true, bytes: 2.3 * 1024 ** 3, truncated: false, note: '只统计能读到的部分' },
      { key: 'edge', label: 'Edge 缓存', exists: true, bytes: 360 * 1024 ** 2, truncated: false, note: '' },
    ],
    cleanupBytes: 3.5 * 1024 ** 3,
    dirs: [
      { drive: 'C', path: 'C:\\ProgramData', name: 'ProgramData', bytes: 5.9 * 1024 ** 3, truncated: false },
      { drive: 'C', path: 'C:\\Users', name: 'Users（所有用户）', bytes: 4.8 * 1024 ** 3, truncated: true },
      { drive: 'D', path: 'D:\\Games', name: 'Games', bytes: 2.3 * 1024 ** 3, truncated: true },
    ],
    files: [
      { path: 'C:\\Users\\you\\Downloads\\installer.zip', name: 'installer.zip', bytes: 233 * 1024 ** 2 },
      { path: 'C:\\Users\\you\\Downloads\\video.mp4', name: 'video.mp4', bytes: 180 * 1024 ** 2 },
    ],
    notes: ['目录大小按扫描上限截断，标「至少」的是下限。', '静态演示只展示扫描；安全清理只在桌面版可用。'],
  });
  if (p === '/api/journal') return j({ entries: SIM.journal.slice() });  if (p === '/api/open') return j({ ok: true, uri: body.uri });
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