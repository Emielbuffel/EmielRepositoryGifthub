// One short sentence about what a company does, from its (long) business description.
// "UCB SA, a biopharmaceutical company, develops products and solutions for people with neurology and immunology
// diseases worldwide. The company…" → "A biopharmaceutical company: develops products and solutions for people with
// neurology and immunology diseases."

const ABBR = /\b(Inc|Co|Corp|Ltd|Plc|S\.A|N\.V|A\.G|AG|SE|S\.p\.A|B\.V|Nos?|U\.S|e\.g|i\.e|St|Mr|Dr|vs)\.$/i;

/** The first sentence of a text (abbreviations such as "Inc." or "N.V." do not end it). */
export function firstSentence(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim(); if (!s) return '';
  let i = 0;
  for (;;) {
    const j = s.indexOf('. ', i); if (j < 0) return s;
    if (!ABBR.test(s.slice(Math.max(0, j - 12), j + 1)) && !/\b[A-Z]$/.test(s.slice(0, j))) return s.slice(0, j + 1);
    i = j + 2;
  }
}

/** A brief of at most `max` characters. */
export function brief(about, name = '', max = 150) {
  let s = firstSentence(about); if (!s) return '';
  s = s.replace(/,? (together|along) with its (subsidiaries|affiliates)( and affiliates)?,?/gi, '')
    .replace(/,? through its (subsidiaries|segments)( and affiliates)?,?/gi, '')
    .replace(/ (worldwide|internationally|globally)\.$/i, '.')
    .replace(/ in the United States and internationally\.$/i, '.')
    .replace(/ in (Belgium|the Netherlands|Germany|France|Japan|South Korea|Hong Kong|China|the United Kingdom) and internationally\.$/i, ' in $1 and abroad.');
  // "Name, a … company, does X" → "A … company: does X"
  const m = /^[^,]{2,80}?, (an? [^,]{3,80}?),\s+(.*)$/i.exec(s);
  if (m) s = m[1].charAt(0).toUpperCase() + m[1].slice(1) + ': ' + m[2];
  else if (name) {
    // drop the company's own name (and its legal form) at the start: "Siemens Energy AG operates as…" → "Operates as…"
    const n = name.replace(/[.,]?\s*(Inc|Corp|Corporation|Ltd|plc|SA|NV|AG|SE|S\.A\.|N\.V\.)\.?$/i, '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (n) s = s.replace(new RegExp('^' + n + '(,?\\s+(Inc|Corp|Corporation|Ltd|plc|SA|NV|AG|SE|S\\.A|N\\.V|S\\.p\\.A|Holdings?|Group|Co)\\.?)*,?\\s+', 'i'), '');
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > max) { s = s.slice(0, max); s = s.slice(0, Math.max(s.lastIndexOf(' '), max - 30)).replace(/[,;:\s]+$/, '') + '…'; }
  return s;
}
