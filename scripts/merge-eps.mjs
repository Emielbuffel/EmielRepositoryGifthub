// Adds longer quarterly EPS history to the built-in snapshot (public/data/meta.json) from a JSON file of
// {SYM: [[periodEnd, reportDate, fiscalYear, fiscalQuarter, adjustedEps, revenue], ...]} (Fiscal.ai adjusted metrics).
// Quarters already in the snapshot keep their figures and estimates unless they differ by more than 5%
// (a different EPS basis); then the new figure is used so the whole line is on one basis.
import fs from 'node:fs';
const [,, file, label = 'Fiscal.ai adjusted metrics'] = process.argv;
const add = JSON.parse(fs.readFileSync(file, 'utf8'));
const f = new URL('../public/data/meta.json', import.meta.url), meta = JSON.parse(fs.readFileSync(f));
const day = d => Date.parse(d + 'T00:00:00Z') / 864e5;
for (const [sym, rows] of Object.entries(add)) {
  const cur = meta.earnings[sym] || (meta.earnings[sym] = { q: [], src: [], industry: '' });
  let added = 0, replaced = 0;
  for (const [, rep, fy, fq, eps, rev] of rows) {
    if (!rep || eps == null) continue;
    const m = cur.q.find(q => Math.abs(day(q.t) - day(rep)) <= 12);
    if (m) {
      if (m.eps == null) continue; // upcoming report
      if (Math.abs(m.eps - eps) > Math.max(0.05 * Math.abs(eps), 0.01)) { m.eps = eps; m.rev = rev; delete m.est; delete m.revEst; replaced++; }
      continue;
    }
    cur.q.push({ t: rep, eps, rev, p: `Q${fq} ${fy}` }); added++;
  }
  cur.q.sort((a, b) => b.t.localeCompare(a.t));
  if (!cur.src.includes(label)) cur.src.push(label);
  console.log(sym.padEnd(8), 'quarters', cur.q.filter(q => q.eps != null).length, '+' + added, replaced ? 'replaced ' + replaced : '');
}
fs.writeFileSync(f, JSON.stringify(meta));
