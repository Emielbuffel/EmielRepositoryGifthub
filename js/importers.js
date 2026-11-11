// File import: screenshots (OCR), PDF statements and CSV exports.
// Everything runs on this device. The OCR engine and Dutch/English language
// data are bundled with the app, so nothing is uploaded anywhere.
import { parseText, parseCsv } from './parser.js';

const abs = (p) => new URL(p, document.baseURI).href;

let workerPromise = null;
let progressCb = null;

async function loadScript(src) {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the OCR engine'));
    document.head.appendChild(s);
  });
}

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(abs('vendor/tesseract/tesseract.min.js'));
      const worker = await window.Tesseract.createWorker(['nld', 'eng'], 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract/lang'),
        gzip: true,
        workerBlobURL: false,
        logger: (m) => progressCb && m.status === 'recognizing text' && progressCb(m.progress),
      });
      await worker.setParameters({ preserve_interword_spaces: '1' });
      return worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Draw an image to a canvas, grayscale it and invert dark-mode screenshots (OCR prefers dark text on light). */
function prepareCanvas(source, w, h) {
  const scale = Math.max(1, Math.min(2.5, 1600 / Math.max(w, 1))); // upscale small images
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    total += g;
  }
  const invert = total / (d.length / 4) < 110;
  const W = canvas.width;
  const H = canvas.height;
  const gray = new Float32Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = invert ? 255 - d[i] : d[i];
  // Local contrast normalisation: compare each pixel with the mean of its neighbourhood, so
  // coloured text (e.g. green "+" amounts) on grey/dark rows becomes dark text on white.
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) {
    let row = 0;
    for (let x = 1; x <= W; x++) {
      row += gray[(y - 1) * W + (x - 1)];
      integral[y * (W + 1) + x] = integral[(y - 1) * (W + 1) + x] + row;
    }
  }
  const r = Math.max(10, Math.round(W / 50));
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const area = (y1 - y0) * (x1 - x0);
      const s = integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0];
      const diff = s / area - gray[y * W + x];
      const v = diff <= 6 ? 255 : Math.max(0, 255 - diff * 4);
      const k = (y * W + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function imageFileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return prepareCanvas(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function ocrCanvas(canvas, onProgress) {
  progressCb = onProgress;
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas);
  progressCb = null;
  return data.text || '';
}

// ------------------------------------------------------------------ PDF ----
let pdfjs = null;
async function getPdfJs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.mjs');
  }
  return pdfjs;
}

/** Rebuild text lines from PDF text items using their positions. */
function itemsToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const hgt = Math.abs(it.transform[3]) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < hgt * 0.5);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join('  ')).join('\n');
}

async function pdfToText(file, onProgress, askPassword) {
  const lib = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({ data, isEvalSupported: false });
  task.onPassword = (update, reason) => {
    const pw = askPassword(reason === 2 ? 'Wrong password, try again:' : `“${file.name}” is password protected. Password:`);
    if (pw === null) task.destroy();
    else update(pw);
  };
  const doc = await task.promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = itemsToLines(tc.items);
    if (text.replace(/\s/g, '').length < 40) {
      // Scanned page without a text layer: render and OCR it
      const vp = page.getViewport({ scale: 2.2 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      text = await ocrCanvas(prepareCanvas(c, c.width, c.height), (pr) => onProgress && onProgress((p - 1 + pr) / doc.numPages));
    }
    out.push(text);
    onProgress && onProgress(p / doc.numPages);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ CSV ----
async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf); // older Belgian bank exports
  }
}

/**
 * Import one file. Returns {items, balance, text, kind}.
 * items: [{date, description, amount, sign, raw}]
 */
export async function importFile(file, { accountType, onProgress, askPassword = (m) => prompt(m) } = {}) {
  const name = file.name.toLowerCase();
  const type = file.type || '';
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const text = await pdfToText(file, onProgress, askPassword);
    return { ...parseText(text, { accountType }), text, kind: 'pdf' };
  }
  if (type.includes('csv') || name.endsWith('.csv') || name.endsWith('.txt') || type === 'text/plain') {
    const text = await readTextSmart(file);
    const r = parseCsv(text, { accountType });
    return { items: r.items, balance: null, text, kind: 'csv' };
  }
  if (type.startsWith('image/') || /\.(png|jpe?g|heic|heif|webp|gif|bmp)$/.test(name)) {
    let canvas;
    try {
      canvas = await imageFileToCanvas(file);
    } catch {
      throw new Error(`Could not open “${file.name}”. If it is a HEIC photo, take a normal screenshot instead (PNG) or export it as JPEG.`);
    }
    const text = await ocrCanvas(canvas, onProgress);
    return { ...parseText(text, { accountType }), text, kind: 'image' };
  }
  throw new Error(`Unsupported file type: ${file.name}`);
}

/** Free the OCR engine's memory when we're done. */
export async function releaseOcr() {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    workerPromise = null;
    if (w) await w.terminate();
  }
}
