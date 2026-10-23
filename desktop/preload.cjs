// Exposes a small, safe API to the web app: GET requests made by the main process.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  get: (url, headers, timeout) => ipcRenderer.invoke('http-get', url, headers, timeout),
  platform: process.platform,
});
