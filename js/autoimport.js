// Merkt sich den gewählten Avinox-Ordner, damit neue Fahrten beim Öffnen der App von selbst geladen werden.
// Der Ordnerzugriff (File System Access API) lässt sich nur in IndexedDB ablegen, nicht in localStorage.
const DB = 'velo-verschleiss', STORE = 'handles', KEY = 'avinox';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const rq = fn(t.objectStore(STORE));
    t.oncomplete = () => res(rq.result);
    t.onerror = () => rej(t.error);
  });
}

export const canRemember = typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
export const saveDir = (handle) => tx('readwrite', (s) => s.put(handle, KEY));
export const loadDir = () => (canRemember ? tx('readonly', (s) => s.get(KEY)).catch(() => null) : Promise.resolve(null));
export const forgetDir = () => tx('readwrite', (s) => s.delete(KEY));

// Darf der Ordner gelesen werden? Nachfragen geht nur direkt nach einem Fingertipp (ask = true).
export async function dirAccess(handle, ask = false) {
  if (!handle) return false;
  try {
    if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true;
    return ask ? (await handle.requestPermission({ mode: 'read' })) === 'granted' : false;
  } catch { return false; }
}
