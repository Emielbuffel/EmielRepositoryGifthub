// Desktop app (Electron) for personal use. It serves the built web app (dist/) from a private app:// origin
// and makes the data requests (Yahoo Finance, SEC EDGAR, news feeds) from the main process, where browser
// CORS rules don't apply. Settings, lists and the price cache live in the app's user-data folder.
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const BUNDLED = path.join(__dirname, '..', 'dist');
const SHELL = 2; // this desktop shell's version (see vite.config.js)
const crypto = require('node:crypto');
const zlib = require('node:zlib');
// Automatic updates: the newest build of the web app is downloaded from your own website (the Cloudflare Pages
// address set in Settings) into the user-data folder and used from the next start. Every file is checked against
// the SHA-256 in version.json. The shell itself (this file) only changes with a new download of the app.
const UPD = () => path.join(app.getPath('userData'), 'ui');
const updFile = () => path.join(app.getPath('userData'), 'update.json');
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
function activeDist() {
  const cur = readJSON(path.join(UPD(), 'current.json')), bundled = readJSON(path.join(BUNDLED, 'version.json'));
  if (cur && cur.dir && fs.existsSync(path.join(UPD(), cur.dir, 'index.html')) && (!bundled || cur.build > bundled.build) && (cur.shell || 1) <= SHELL) return path.join(UPD(), cur.dir);
  return BUNDLED;
}
let DIST = BUNDLED;
const upd = { site: '', gh: false, src: '', state: 'idle', build: '', note: '' };
// a .tar archive (uncompressed) -> Map(path -> Buffer)
function untar(buf) {
  const out = new Map(); let o = 0;
  while (o + 512 <= buf.length) {
    const h = buf.subarray(o, o + 512); if (h.every(x => x === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 500) ? str(345, 500) + '/' : '') + str(0, 100), size = parseInt(str(124, 136).trim() || '0', 8), type = String.fromCharCode(h[156] || 48);
    o += 512;
    if (type === '0' || type === '\0') out.set(name.replace(/^\.\//, ''), Buffer.from(buf.subarray(o, o + size)));
    o += Math.ceil(size / 512) * 512;
  }
  return out;
}
const GH_REPO = 'Emielbuffel/EmielRepositoryGifthub';
async function ghAsset(token, name) {
  const H = { Authorization: 'Bearer ' + token, 'User-Agent': 'BasePatternDesk', 'X-GitHub-Api-Version': '2022-11-28' };
  const rel = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/tags/latest`, { headers: { ...H, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (rel.status === 401 || rel.status === 404) throw new Error('GitHub refused the token (check that it can read this repository).');
  if (!rel.ok) throw new Error('GitHub: HTTP ' + rel.status);
  const a = ((await rel.json()).assets || []).find(x => x.name === name);
  if (!a) throw new Error(name + ' is not in the latest release yet (GitHub builds it after each update).');
  const r = await fetch(a.url, { headers: { ...H, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
// where the newest build comes from: your website (Cloudflare Pages) or the GitHub release (with a read-only token)
async function remoteBuild(cfg) {
  const testHttp = process.env.BPD_UPDATE_TEST_HTTP === '1' && /^http:\/\/127\.0\.0\.1:/.test(cfg.site || ''); // local tests only
  if (/^https:\/\//.test(cfg.site || '') || testHttp) {
    const base = cfg.site.replace(/\/+$/, '') + '/';
    const r = await fetch(base + 'version.json', { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('version.json: HTTP ' + r.status);
    return { v: await r.json(), src: 'website', file: async p => { const x = await fetch(base + p, { signal: AbortSignal.timeout(120000) }); if (!x.ok) throw new Error(p + ': HTTP ' + x.status); return Buffer.from(await x.arrayBuffer()); } };
  }
  if (cfg.gh) {
    const v = JSON.parse((await ghAsset(cfg.gh, 'version.json')).toString('utf8')); let files = null;
    return { v, src: 'GitHub', file: async p => { if (!files) files = untar(zlib.gunzipSync(await ghAsset(cfg.gh, 'web-build.tar.gz'))); const b = files.get(p); if (!b) throw new Error(p + ' missing in the download'); return b; } };
  }
  return null;
}
async function checkUpdate(win) {
  const cfg = readJSON(updFile()) || {}; upd.site = cfg.site || ''; upd.gh = !!cfg.gh;
  try {
    upd.state = 'checking'; upd.note = '';
    const R = await remoteBuild(cfg);
    if (!R) { upd.state = 'off'; return upd; }
    const v = R.v, have = readJSON(path.join(DIST, 'version.json')) || {};
    upd.src = R.src;
    if (!v.build || v.build <= (have.build || '')) { upd.state = 'latest'; upd.build = have.build || ''; return upd; }
    if ((v.shell || 1) > SHELL) { upd.state = 'shell'; upd.build = v.build; upd.note = 'This update needs a new download of the desktop app (GitHub → Releases → Latest build).'; return upd; }
    upd.state = 'downloading'; upd.build = v.build;
    const dir = 'b' + v.build.replace(/[^0-9a-z-]/gi, ''), tmp = path.join(UPD(), dir + '.tmp');
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    // reuse unchanged files from the running build, download the rest
    const local = new Map(((have.files) || []).map(f => [f.path + '|' + f.sha256, path.join(DIST, f.path)]));
    for (const f of v.files) {
      if (!/^[\w./-]+$/.test(f.path) || f.path.includes('..')) throw new Error('Bad file name ' + f.path);
      const out = path.join(tmp, f.path); fs.mkdirSync(path.dirname(out), { recursive: true });
      const same = local.get(f.path + '|' + f.sha256);
      const buf = same && fs.existsSync(same) ? fs.readFileSync(same) : await R.file(f.path);
      if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error('Checksum mismatch for ' + f.path);
      fs.writeFileSync(out, buf);
    }
    fs.writeFileSync(path.join(tmp, 'version.json'), JSON.stringify(v));
    fs.rmSync(path.join(UPD(), dir), { recursive: true, force: true }); fs.renameSync(tmp, path.join(UPD(), dir));
    const prev = readJSON(path.join(UPD(), 'current.json'));
    fs.writeFileSync(path.join(UPD(), 'current.json'), JSON.stringify({ dir, build: v.build, shell: v.shell || 1 }));
    for (const d of fs.readdirSync(UPD())) if (d !== dir && d !== (prev && prev.dir) && d !== 'current.json') fs.rmSync(path.join(UPD(), d), { recursive: true, force: true });
    upd.state = 'ready';
    if (win && !win.isDestroyed()) win.webContents.send('update-ready', v.build);
  } catch (e) { upd.state = 'error'; upd.note = String(e.message || e); }
  return upd;
}
ipcMain.handle('set-update-site', (_e, site) => { const c = readJSON(updFile()) || {}; c.site = String(site || '').trim(); fs.writeFileSync(updFile(), JSON.stringify(c)); return true; });
// a GitHub token that can read this (private) repository: stored only in the app's own folder, sent only to GitHub
ipcMain.handle('set-github-token', (_e, token) => { const c = readJSON(updFile()) || {}; c.gh = String(token || '').trim(); fs.writeFileSync(updFile(), JSON.stringify(c)); return true; });
ipcMain.handle('update-check', () => checkUpdate(BrowserWindow.getAllWindows()[0]));
ipcMain.handle('update-status', () => ({ ...upd, shell: SHELL, running: (readJSON(path.join(DIST, 'version.json')) || {}).build || '' }));
ipcMain.handle('update-restart', () => { app.relaunch(); app.exit(0); });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

// Yahoo's fundamentals/calendar endpoints need a session cookie plus a "crumb" token. URLs from the app
// carry the placeholder crumb=__CRUMB__, filled in here (cached for 6 hours, refreshed once on 401/403).
const yh = { cookie: '', crumb: '', at: 0 };
async function yahooCrumb(force) {
  if (!force && yh.crumb && Date.now() - yh.at < 6 * 3600e3) return yh;
  const r = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(15000) }).catch(() => null);
  const set = r && r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  yh.cookie = set.map(c => c.split(';')[0]).join('; ');
  const c = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: yh.cookie }, signal: AbortSignal.timeout(15000) });
  yh.crumb = c.ok ? (await c.text()).trim() : ''; yh.at = Date.now();
  return yh;
}

// GET for the renderer: http(s) only, with a timeout. Returns {status, text}.
ipcMain.handle('http-get', async (_e, url, headers = {}, timeout = 30000) => {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Only http(s) URLs');
  const go = async force => {
    let u = url; const h = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers };
    if (u.includes('crumb=__CRUMB__')) { const y = await yahooCrumb(force); u = u.replace('__CRUMB__', encodeURIComponent(y.crumb)); if (y.cookie) h.Cookie = y.cookie; }
    const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(Math.min(+timeout || 30000, 120000)), redirect: 'follow' });
    return { status: r.status, text: await r.text() };
  };
  let res = await go(false);
  if ((res.status === 401 || res.status === 403) && url.includes('crumb=__CRUMB__')) res = await go(true);
  return res;
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
  DIST = activeDist();
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  // check for a new build shortly after start and then every 3 hours
  setTimeout(() => checkUpdate(BrowserWindow.getAllWindows()[0]), 8000);
  setInterval(() => checkUpdate(BrowserWindow.getAllWindows()[0]), 3 * 3600e3);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
