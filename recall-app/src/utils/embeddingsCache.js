const DB_NAME = 'embeddings_cache_db';
const STORE_NAME = 'chunks_cache';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });

  return dbPromise;
}

/**
 * Computes a standard SHA-256 hexadecimal hash string for any input text
 * @param {string} text 
 * @returns {Promise<string>}
 */
export async function computeTextHash(text) {
  if (!text) return '';
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Tries to fetch a cached server embedding vector for a given text hash.
 * @param {string} hash 
 * @returns {Promise<Array<number>|null>}
 */
export async function getCachedEmbedding(hash) {
  if (!hash) return null;
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(hash);
      request.onsuccess = () => resolve(request.result?.vector || null);
      request.onerror = () => resolve(null);
    });
  } catch (err) {
    console.error("IndexedDB cache get failed:", err);
    return null;
  }
}

/**
 * Caches a server embedding vector associated with a text hash in IndexedDB.
 * @param {string} hash 
 * @param {Array<number>} vector 
 * @returns {Promise<boolean>}
 */
export async function cacheEmbedding(hash, vector) {
  if (!hash || !vector) return false;
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ hash, vector });
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (err) {
    console.error("IndexedDB cache put failed:", err);
    return false;
  }
}
