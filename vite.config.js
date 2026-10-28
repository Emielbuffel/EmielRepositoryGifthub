import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Build id: date and time plus the commit when known (CI / Cloudflare Pages). Shown in Settings and used for updates.
const now = new Date(), sha = (process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 7);
const BUILD = now.toISOString().slice(0, 16).replace(/[-:T]/g, '') + (sha ? '-' + sha : '');
// The desktop shell that can apply this build (raise when desktop/main.cjs or preload.cjs change in a way the web app needs).
const SHELL = 2;

/**
 * After the build: version.json (build id + every file with its SHA-256, read by the desktop app's updater) and the
 * service worker for the installable web/phone app, which caches the app for offline use and updates it.
 */
function release() {
  return {
    name: 'release-files',
    closeBundle() {
      const dir = path.resolve('dist'), files = [];
      const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(p); } };
      walk(dir);
      const list = files.map(p => ({ path: path.relative(dir, p).split(path.sep).join('/'), size: fs.statSync(p).size, sha256: createHash('sha256').update(fs.readFileSync(p)).digest('hex') }))
        .filter(f => f.path !== 'version.json' && f.path !== 'sw.js');
      const app = list.filter(f => !f.path.startsWith('data/')).map(f => './' + f.path);
      const sw = fs.readFileSync(path.resolve('scripts/sw-template.js'), 'utf8').replace('__BUILD__', BUILD).replace('"__APP_FILES__"', JSON.stringify(app));
      fs.writeFileSync(path.join(dir, 'sw.js'), sw);
      list.push({ path: 'sw.js', size: Buffer.byteLength(sw), sha256: createHash('sha256').update(sw).digest('hex') });
      fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ build: BUILD, shell: SHELL, at: now.toISOString(), files: list }, null, 0));
    },
  };
}

// base './' so the built app works from Capacitor's local file server, the desktop app and any web folder.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: { outDir: 'dist', target: 'safari15', assetsInlineLimit: 0, chunkSizeWarningLimit: 800 },
  server: { host: true },
  plugins: [release()],
});
