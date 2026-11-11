// Turns the web build (dist/) into the files of the claude.ai page (the iPhone Home Screen page):
//   node scripts/build-artifact.mjs OUTDIR        (run `npx vite build` first)
// Writes OUTDIR/base-pattern-desk.html (the page), OUTDIR/assets/*, OUTDIR/data/*, OUTDIR/icon.svg and
// OUTDIR/files.json: the `files` map for the Artifact tool (published path → {from, contentType?}).
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname, dist = path.join(root, 'dist');
const out = path.resolve(process.argv[2] || 'artifact-out');
const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const entry = /<script type="module"[^>]*src="\.\/assets\/([^"]+)"/.exec(index)[1];
const cssFile = /<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"/.exec(index)[1];
const css = fs.readFileSync(path.join(dist, 'assets', cssFile), 'utf8');
const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(index)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.mkdirSync(path.join(out, 'data'), { recursive: true });

const page = `<title>Base Pattern Desk</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="icon" href="./icon.svg" type="image/svg+xml">
<script type="module" src="./assets/${entry}"></script>
<style>${css}</style>
${body}
`;
fs.writeFileSync(path.join(out, 'base-pattern-desk.html'), page);

// The publisher refuses raw U+FFFD and control characters: write them as escapes (they only occur inside strings).
const esc = t => t.replace(/\ufffd/g, '\\ufffd').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const files = {};
for (const f of fs.readdirSync(path.join(dist, 'assets'))) {
  if (!/\.(m?js)$/.test(f)) continue;
  const to = path.join(out, 'assets', f);
  fs.writeFileSync(to, esc(fs.readFileSync(path.join(dist, 'assets', f), 'utf8')));
  files['assets/' + f] = f.endsWith('.mjs') ? { from: to, contentType: 'text/javascript' } : { from: to };
}
for (const f of fs.readdirSync(path.join(dist, 'data'))) {
  if (!f.endsWith('.json')) continue;
  const to = path.join(out, 'data', f);
  fs.copyFileSync(path.join(dist, 'data', f), to);
  files['data/' + f] = { from: to };
}
fs.copyFileSync(path.join(dist, 'icon.svg'), path.join(out, 'icon.svg'));
files['icon.svg'] = { from: path.join(out, 'icon.svg') };
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 1));
const meta = JSON.parse(fs.readFileSync(path.join(dist, 'data', 'meta.json')));
console.log(`page + ${Object.keys(files).length} files in ${out} (entry ${entry}; prices through ${meta.asOf})`);
