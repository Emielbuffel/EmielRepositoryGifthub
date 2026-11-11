// Text lines of a PDF, top to bottom, using pdf.js (Mozilla's open-source PDF reader). Pieces of text on the same
// height are joined into one line, left to right, so each statement row becomes one line of text.
let lib = null;
async function pdfjs() {
  if (lib) return lib;
  lib = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  return lib;
}

/** file: a File/Blob or an ArrayBuffer. Returns {lines: [string], pages}. */
export async function pdfLines(file) {
  const P = await pdfjs();
  const data = new Uint8Array(file instanceof ArrayBuffer ? file : await file.arrayBuffer());
  const doc = await P.getDocument({ data, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || it.height || 8, s: it.str }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const r = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.4));
      if (r) r.items.push(it); else rows.push({ y: it.y, h: it.h, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y).forEach(r => lines.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s.trim()).join(' ')));
    page.cleanup();
  }
  const pages = doc.numPages; await doc.destroy();
  return { lines, pages };
}
