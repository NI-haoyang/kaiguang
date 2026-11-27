'use strict';
// 小白助手 · 桌面壳：起本地服务 → 开窗口 → 关窗口时收摊。
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server = null;
let win = null;

async function boot() {
  const entry = pathToFileURL(path.join(__dirname, '..', 'server.mjs')).href;
  const mod = await import(entry);
  server = await mod.start(0);                       // 0 = 让系统挑一个空闲端口
  // KG_URL 只给回归测试用：直接把窗口指到某个页面（比如静态演示 html）
  const url = process.env.KG_URL || ('http://127.0.0.1:' + server.port + '/');

  win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 1180, minHeight: 700,
    backgroundColor: '#080b09', show: false, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#080b09', symbolColor: '#93a39a', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, spellcheck: false,
    },
  });

  // 窗口一开始是隐藏的，等首帧画好再显示；但 ready-to-show 偶尔不触发（Chromium 在隐藏窗口上推迟首帧），
  // 所以再加两道兜底：页面加载完 800ms 后显示，最多 4 秒无条件显示。宁可早一点出现，也不要"点了没反应"。
  const reveal = () => { try { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); } catch {} };
  win.loadURL(url);
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', () => setTimeout(reveal, 800));
  setTimeout(reveal, 4000);
  win.webContents.on('did-fail-load', (_e, code, desc, u) => {
    console.error('load failed', code, desc, u);
    dialog.showErrorBox('页面没加载出来', '错误码 ' + code + '：' + desc + '\n' + u);
  });
  win.on('closed', () => { win = null; });


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

if (!process.env.KG_TEST_NO_LOCK && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    // 窗口可能因为上一次的异常还藏在后台：再点一次图标的人期待的是"窗口出现"，不是"进程已存在"。
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(boot).catch((err) => {
    dialog.showErrorBox('小白助手启动失败', String(err && err.stack || err));
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { try { server && server.close(); } catch {} });
}