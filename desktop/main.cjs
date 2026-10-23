// Desktop app (Electron) for personal use. It serves the built web app (dist/) from a private app:// origin
// and makes the data requests (Yahoo Finance, SEC EDGAR, news feeds) from the main process, where browser
// CORS rules don't apply. Settings, lists and the price cache live in the app's user-data folder.
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

// GET for the renderer: http(s) only, with a timeout. Returns {status, text}.
ipcMain.handle('http-get', async (_e, url, headers = {}, timeout = 30000) => {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Only http(s) URLs');
  const h = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers };
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(Math.min(+timeout || 30000, 120000)), redirect: 'follow' });
  return { status: r.status, text: await r.text() };
});

const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1440, height: 920 }; } }

function createWindow() {
  const b = loadBounds();
  const win = new BrowserWindow({
    ...b, minWidth: 900, minHeight: 600, title: 'Base Pattern Desk', backgroundColor: '#f2f2f7', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', () => { try { fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch (e) { /* ignore */ } });
  // links (news articles, sources) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.loadURL('app://desk/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
