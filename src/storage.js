// Storage I/O: IndexedDB is the primary store, localStorage a mirror/fallback.
// Both hold the same versioned object. Failures are reported, never swallowed silently.

import { migrate, serialize, APP_ID } from './progress.js';

const DB_NAME = APP_ID;
const STORE = 'progress';
const KEY = 'current';
const LS_KEY = `${APP_ID}:progress`;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('localStorage read failed', error);
    return null;
  }
}

function writeLocal(progress) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(progress));
    return true;
  } catch (error) {
    console.warn('localStorage write failed', error);
    return false;
  }
}

// Returns { progress | null, warning | null }. A newer-schema save is left untouched.
export async function loadProgress(now) {
  let stored = null;
  try {
    stored = await idbRequest('readonly', (store) => store.get(KEY));
  } catch (error) {
    console.warn('IndexedDB read failed, falling back to localStorage', error);
  }
  const raw = stored ?? readLocal();
  if (!raw) return { progress: null, warning: null };
  try {
    return { progress: migrate(raw, now), warning: null };
  } catch (error) {
    return { progress: null, warning: error.message, locked: true };
  }
}

export async function saveProgress(progress) {
  const mirrored = writeLocal(progress);
  try {
    await idbRequest('readwrite', (store) => store.put(progress, KEY));
    return true;
  } catch (error) {
    console.warn('IndexedDB write failed', error);
    return mirrored;
  }
}

export async function clearProgress() {
  try { localStorage.removeItem(LS_KEY); } catch (error) { console.warn('localStorage clear failed', error); }
  try { await idbRequest('readwrite', (store) => store.delete(KEY)); } catch (error) { console.warn('IndexedDB clear failed', error); }
}

export async function requestDurableStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch (error) {
    console.warn('Durable storage request failed', error);
    return false;
  }
}

// Hands the backup to the share sheet (iOS: Save to Files); falls back to a download.
export async function shareBackup(progress, now) {
  const name = `wheel-trainer-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
  const file = new File([serialize(progress, now)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Roulette Wheel Trainer backup' });
      return true;
    } catch (error) {
      if (error.name === 'AbortError') return false;
      console.warn('Share failed, falling back to download', error);
    }
  }
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
