'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kgDesktop', {
  isDesktop: true,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  onWeekly: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('kg-weekly', (_e, w) => cb(w));
  },
});