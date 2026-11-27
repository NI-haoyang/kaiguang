'use strict';
// 小白助手 · 桌面壳：起本地服务 → 开窗口 → 托盘常驻 → 每周自检。
const { app, BrowserWindow, shell, dialog, Tray, Menu, Notification, nativeImage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const WEEK = 7 * 24 * 60 * 60 * 1000;
const HIDDEN = process.argv.includes('--autostart') || process.argv.includes('--hidden') || process.env.KG_HIDDEN === '1';
let server = null;
let win = null;
let tray = null;
let quitting = false;
let settingsMod = null;
let scheduleMod = null;
let iconPath = null;
let trayTimer = null;
let weeklyBusy = false;

function appIcon() { return path.join(__dirname, '..', 'ui', 'icon.png'); }

function showWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, icon: appIcon() });
      n.on('click', showWin);
      n.show();
      return;
    }
  } catch {}
  try { if (tray) tray.displayBalloon({ title, content: body }); } catch {}
}

function autoStartOn() {
  try { return settingsMod ? settingsMod.load().autoStart !== false : true; } catch { return true; }
}

function applyAutoStart(on) {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--autostart'] }); } catch {}
}

function weeklyOn() {
  try { return settingsMod ? settingsMod.load().weekly !== false : true; } catch { return true; }
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开小白助手', click: showWin },
    { label: '本周体检报告', click: () => { showWin(); setTimeout(() => { try { win.webContents.executeJavaScript("window.kgShowWeekly && window.kgShowWeekly()"); } catch {} }, 700); } },
    { label: '立即体检', click: () => { showWin(); setTimeout(() => { try { win.webContents.executeJavaScript("window.kgScanNow && window.kgScanNow()"); } catch {} }, 700); } },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: autoStartOn(), click: (item) => { settingsMod.save({ autoStart: !!item.checked }); applyAutoStart(item.checked); refreshTray(); } },
    { label: '每周体检', type: 'checkbox', checked: weeklyOn(), click: (item) => { settingsMod.save({ weekly: !!item.checked }); refreshTray(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(trayMenu());
}

function createTray() {
  try {
    let img = nativeImage.createFromPath(path.join(__dirname, '..', 'ui', 'tray.png'));
    if (img.isEmpty()) img = nativeImage.createFromPath(appIcon());
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('小白助手 · 每周帮你体检');
    tray.on('click', showWin);
    refreshTray();
  } catch (e) { console.error('tray failed', e); tray = null; }
}

async function maybeWeekly() {
  if (!server || weeklyBusy) return;
  if (!weeklyOn()) return;
  const last = Number((scheduleMod && scheduleMod.load().lastWeeklyAt) || 0);
  if (last && Date.now() - last < WEEK) return;
  weeklyBusy = true;
  try {
    const ok = await server.scan();
    if (ok === false) { weeklyBusy = false; return; }
    scheduleMod.save({ lastWeeklyAt: Date.now() });
    const w = server.weekly();
    if (w && !w.first) {
      if (win && win.isVisible()) {
        try { win.webContents.send('kg-weekly', w); } catch {}
      } else {
        notify('本周体检完成', w.short + '。打开小白助手看详情。');
      }
    }
  } catch (e) { console.error('weekly failed', e); }
  weeklyBusy = false;
}

async function boot() {
  const entry = pathToFileURL(path.join(__dirname, '..', 'server.mjs')).href;
  const mod = await import(entry);
  server = await mod.start(0);
  settingsMod = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'settings.mjs')).href);
  scheduleMod = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'schedule.mjs')).href);
  applyAutoStart(autoStartOn());

  const url = process.env.KG_URL || ('http://127.0.0.1:' + server.port + '/');
  const icon = appIcon();
  win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 1180, minHeight: 700,
    backgroundColor: '#080b09', show: false, autoHideMenuBar: true, icon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#080b09', symbolColor: '#93a39a', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, spellcheck: false,
    },
  });

  // 窗口一开始是隐藏的，等首帧画好再显示；但 ready-to-show 偶尔不触发（Chromium 在隐藏窗口上推迟首帧），
  // 所以再加两道兜底：页面加载完 800ms 后显示，最多 4 秒无条件显示。宁可早一点出现，也不要"点了没反应"。
  const reveal = () => { try { if (!HIDDEN && win && !win.isDestroyed() && !win.isVisible()) win.show(); } catch {} };
  win.loadURL(url);
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', () => setTimeout(reveal, 800));
  setTimeout(reveal, 4000);
  win.webContents.on('did-fail-load', (_e, code, desc, u) => {
    console.error('load failed', code, desc, u);
    dialog.showErrorBox('页面没加载出来', '错误码 ' + code + '：' + desc + '\n' + u);
  });
  win.on('close', (e) => { if (!quitting && tray) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });

  createTray();

  // 自动启动时保持安静；手动打开时第一次留在托盘里给一句提示。
  if (!HIDDEN && !(scheduleMod.load().trayHint)) {
    setTimeout(() => {
      try { notify('小白助手在托盘里', '关掉窗口我也不会走，每周帮你体检一次。要退出，右键托盘图标。'); scheduleMod.save({ trayHint: true }); } catch {}
    }, 3500);
  }
  setTimeout(maybeWeekly, 2600);
  trayTimer = setInterval(maybeWeekly, 6 * 60 * 60 * 1000);
  try { powerMonitor.on('resume', maybeWeekly); } catch {}

  // 演示驱动：KG_DRIVE=cards|exec，自动走一遍对话，便于出截图与回归测试。
  if (process.env.KG_DRIVE) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const js = (code) => win.webContents.executeJavaScript(code, true);
      try {
        const until = async (expr, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr)) return true; await wait(500); } return false; };
        await until("document.querySelectorAll('.card').length > 0", 120000);
        await wait(600);
        const driveText = process.env.KG_DRIVE === 'ask' ? (process.env.KG_ASK_Q || 'TX Mascot 是干什么的') : '打游戏';
        await js("(() => { const i = document.querySelector('#input'); i.value = " + JSON.stringify(driveText) + "; document.querySelector('#send').click(); return true; })()");
        await wait(300);
        await until("!document.querySelector('.pending')", 120000);
        await wait(800);
        if (process.env.KG_DRIVE === 'exec') {
          await js("document.querySelectorAll('.card .box').forEach(b => b.click()); true");
          await wait(500);
          await js("(() => { const bs = document.querySelectorAll('.card .box'); if (bs.length) bs[bs.length - 1].click(); return true; })()");
          await wait(600);
          await js("document.querySelector('#go') && document.querySelector('#go').click(); true");
          await wait(2600);
        }
        console.log('drive done: cards=' + await js("document.querySelectorAll('.card').length"));

        if (process.env.KG_DRIVE === 'disk') {
          await js("document.querySelector('#btnDisk') && document.querySelector('#btnDisk').click(); true");
          await until("document.querySelectorAll('#diskBody .drive').length > 0", 45000);
          await wait(700);
          console.log('drive disk: drives=' + await js("document.querySelectorAll('#diskBody .drive').length") + ' rows=' + await js("document.querySelectorAll('#diskBody .disk-row').length"));
        }

        if (process.env.KG_DRIVE === 'clean') {
          await js("document.querySelector('#btnDisk') && document.querySelector('#btnDisk').click(); true");
          await until("document.querySelectorAll('#diskBody .disk-row.cleanable').length > 0", 45000);
          await wait(500);
          await js("window.confirm = () => true; (() => { const b = document.querySelector('#diskBody .disk-row.cleanable .clean-box'); if (b) b.click(); const go = document.querySelector('#diskClean'); if (go) go.click(); return true; })()");
          await until("document.querySelector('#diskResult') && document.querySelector('#diskResult').textContent.trim().length > 0", 60000);
          console.log('drive clean: ' + await js("document.querySelector('#diskResult').textContent"));
        }

        if (process.env.KG_DRIVE === 'apps') {
          await js("document.querySelector('#btnApps') && document.querySelector('#btnApps').click(); true");
          await wait(1800);
          console.log('drive apps: rows=' + await js("document.querySelectorAll('.app-row').length") + ' installed=' + await js("document.querySelectorAll('.app-row.on').length"));
        }

        if (process.env.KG_DRIVE === 'ask') {
          const snap = async () => await js("JSON.stringify({setCount: document.querySelectorAll('#thread .cards').length, picked: document.querySelectorAll('.card.pick').length, go: (document.querySelector('#go')||{}).textContent, lastSay: ([...document.querySelectorAll('.msg.ai .body')].pop()||{}).textContent, titles: [...document.querySelectorAll('.card h3')].map(h => h.textContent)})");
          const out = { afterAsk: JSON.parse(await snap()) };
          if (process.env.KG_DRIVE_OUT) require('node:fs').writeFileSync(process.env.KG_DRIVE_OUT, JSON.stringify(out, null, 2), 'utf8');
          console.log('drive ask: ' + JSON.stringify(out));
        }
      } catch (e) { console.error('drive failed', e); }
      if (process.env.KG_SHOT) {
        try {
          if (process.env.KG_SHOT_TOP) await js("document.querySelector('#thread') && (document.querySelector('#thread').scrollTop = 0); true");
          win.show(); win.focus();
          const img = await Promise.race([win.webContents.capturePage(), new Promise((r) => setTimeout(() => r(null), 6000))]);
          if (img) require('node:fs').writeFileSync(process.env.KG_SHOT, img.toPNG());
          else console.log('shot timeout');
        } catch (e) { console.log('shot failed ' + e.message); }
      }
      if (process.env.KG_SHOT_UNDO) {
        try {
          await js("(() => { const b = document.querySelector('#bar .btn.ghost'); if (b) b.click(); return true; })()");
          await wait(2200);
          require('node:fs').writeFileSync(process.env.KG_SHOT_UNDO, (await win.webContents.capturePage()).toPNG());
        } catch {}
      }
      app.quit();
    });
  }

  // 截图模式：KG_SHOT=<png 路径> 时，加载完成后把窗口画一张、退出。给文档和答辩材料用。
  if (process.env.KG_SHOT && !process.env.KG_DRIVE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.KG_SHOT_DELAY || 1500)));
      try {
        console.log('desktop-class:', await win.webContents.executeJavaScript('!!window.kgDesktop + "|" + document.body.className + "|" + getComputedStyle(document.querySelector(".top")).paddingRight'));
        const image = await win.webContents.capturePage();
        require('node:fs').writeFileSync(process.env.KG_SHOT, image.toPNG());
      } catch (e) { console.error('shot failed', e); }
      app.quit();
    });
  }

  // 页面里的外链一律交给系统浏览器，不在壳里开新窗口
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith('http://127.0.0.1:' + server.port)) { e.preventDefault(); shell.openExternal(u); }
  });
}

app.setAppUserModelId('com.xiaobai.helper');

if (!process.env.KG_TEST_NO_LOCK && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWin());
  app.on('activate', () => showWin());
  app.whenReady().then(boot).catch((err) => {
    dialog.showErrorBox('小白助手启动失败', String(err && err.stack || err));
    app.quit();
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('before-quit', () => {
    quitting = true;
    if (trayTimer) { clearInterval(trayTimer); trayTimer = null; }
    try { server && server.close(); } catch {}
  });
}