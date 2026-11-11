// Encrypted local storage.
// Everything you enter is kept in this device's IndexedDB, encrypted with
// AES-GCM 256. The key is derived from your passcode with PBKDF2-SHA256
// (600,000 iterations). The passcode itself is never stored.

const DB_NAME = 'cashflow-vault';
const STORE = 'kv';
export const PBKDF2_ITERATIONS = 600000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function deriveKey(passcode, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(data) };
}

export async function decryptJson(key, box) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
  return JSON.parse(dec.decode(plain));
}

export class Vault {
  constructor() {
    this.key = null;
    this.meta = null;
  }

  async exists() {
    this.meta = await idbGet('meta');
    return !!this.meta;
  }

  async create(passcode, initialState) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    this.meta = { v: 1, salt: b64(salt), iterations: PBKDF2_ITERATIONS, createdAt: new Date().toISOString() };
    this.key = await deriveKey(passcode, salt, PBKDF2_ITERATIONS);
    await idbSet('meta', this.meta);
    await this.save(initialState);
  }

  /** Returns the decrypted state, or throws if the passcode is wrong. */
  async unlock(passcode) {
    if (!this.meta) this.meta = await idbGet('meta');
    const key = await deriveKey(passcode, unb64(this.meta.salt), this.meta.iterations);
    const box = await idbGet('vault');
    const state = await decryptJson(key, box); // throws on wrong passcode (auth tag mismatch)
    this.key = key;
    return state;
  }

  async save(state) {
    if (!this.key) throw new Error('Vault is locked');
    const box = await encryptJson(this.key, state);
    await idbSet('vault', box);
  }

  async changePasscode(newPasscode, state) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(newPasscode, salt, PBKDF2_ITERATIONS);
    const meta = { ...this.meta, salt: b64(salt), iterations: PBKDF2_ITERATIONS };
    const box = await encryptJson(key, state);
    await idbSet('meta', meta);
    await idbSet('vault', box);
    this.meta = meta;
    this.key = key;
  }

  /** An encrypted backup file, protected by the same passcode. */
  async exportBackup(state) {
    const box = await encryptJson(this.key, state);
    return { app: 'cashflow-compass', format: 1, salt: this.meta.salt, iterations: this.meta.iterations, ...box, exportedAt: new Date().toISOString() };
  }

  static async readBackup(fileObj, passcode) {
    if (fileObj.app !== 'cashflow-compass') throw new Error('This is not a Cashflow Compass backup file.');
    const key = await deriveKey(passcode, unb64(fileObj.salt), fileObj.iterations);
    return decryptJson(key, fileObj);
  }

  lock() {
    this.key = null;
  }

  async wipe() {
    this.key = null;
    this.meta = null;
    await idbClear();
  }
}
