// Exposes a small, safe API to the web app: GET requests made by the main process.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  get: (url, headers, timeout) => ipcRenderer.invoke('http-get', url, headers, timeout),
  platform: process.platform,
  setUpdateSite: site => ipcRenderer.invoke('set-update-site', site),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  restart: () => ipcRenderer.invoke('update-restart'),
  onUpdateReady: fn => ipcRenderer.on('update-ready', (_e, build) => fn(build)),
});
