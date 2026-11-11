// Storage: IndexedDB primary, localStorage fallback for state; localStorage for small settings.
// Versioned payload + save-failure reporting. No cloud sync is claimed anywhere.
import { freshState, DATA_VERSION } from './core.js?v=6';

const DB_NAME = 'hsk-daily-dashboard';
const LS_STATE = 'hsk-daily-dashboard.state-v1';
const LS_SETTINGS = 'hsk-daily-dashboard.settings-v1';

let idb = null;
function openDb() {
  if (idb) return idb;
  idb = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idb;
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbSet(key, val) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

export async function loadState(onWarn) {
  // F5: both stores are read and the NEWER copy wins (updatedAt), so a session
  // that fell back to localStorage is never silently rolled back by IndexedDB.
  let idbState = null, lsState = null;
  try { const v = await idbGet('state'); if (v && v.version === DATA_VERSION) idbState = v; } catch { /* ignore */ }
  try { const raw = localStorage.getItem(LS_STATE); if (raw) { const v = JSON.parse(raw); if (v && v.version === DATA_VERSION) lsState = v; } } catch { onWarn && onWarn('Không đọc được dữ liệu đã lưu. Bắt đầu với dữ liệu trống — hãy khôi phục từ bản sao lưu nếu có.'); }
  if (idbState && lsState) return (lsState.updatedAt || 0) > (idbState.updatedAt || 0) ? lsState : idbState;
  if (idbState || lsState) return idbState || lsState;
  const s = freshState(); s.createdAt = new Date().toISOString();
  return s;
}

let saveOk = true;
export async function saveState(state, onWarn) {
  state.updatedAt = Date.now();
  let ok = false;
  try { await idbSet('state', state); ok = true; } catch { /* try fallback */ }
  if (!ok) {
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); ok = true; } catch { ok = false; }
  }
  if (!ok && saveOk) onWarn && onWarn('Lưu thất bại: bộ nhớ trình duyệt không khả dụng hoặc đã đầy. Hãy xuất bản sao lưu ngay.');
  saveOk = ok;
  return ok;
}

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null') || {}; } catch { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); return true; } catch { return false; }
}

export function exportJson(state, settings) {
  return JSON.stringify({ app: 'hsk-daily-dashboard', version: DATA_VERSION, exportedAt: new Date().toISOString(), state, settings }, null, 2);
}
export function parseImport(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'hsk-daily-dashboard' || !data.state || data.version !== DATA_VERSION || !data.state.days || !data.state.items) throw new Error('File không phải bản sao lưu hợp lệ của HSK Daily Dashboard.');
  return data;
}
