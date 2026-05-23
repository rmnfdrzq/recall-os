const isDesktop = () => {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
};

const getBackendHost = () => {
  // If running in Tauri desktop, always route to local Django
  if (isDesktop()) {
    return 'http://127.0.0.1:8000';
  }
  // During local development, route to local Django
  if (import.meta.env.DEV) {
    return 'http://127.0.0.1:8000';
  }
  // In production SaaS mode, route to centralized cloud API
  return 'https://api.recallos.com';
};

const BACKEND_HOST = getBackendHost();
const EMBEDDINGS_ENDPOINT = `${BACKEND_HOST}/api/embeddings/`;

/**
 * Initializes the embeddings engine.
 * Offloaded to host Ollama via stateless API, so no local model downloads are needed!
 * @param {Function} [onProgress] - Callback function receiving status
 */
export async function initEmbeddingsEngine(onProgress) {
  if (onProgress) {
    onProgress({
      progress: 100,
      status: 'ready',
      file: '',
      label: 'Semantic engine ready'
    });
  }
}

/**
 * Calculates high-dimensional vector embeddings for a list of text strings in batch
 * using the stateless server API backed by host Ollama.
 * @param {Array<string>} texts - List of text chunks to calculate embeddings for
 * @param {Function} [onProgress] - Optional progress callback
 * @returns {Promise<Array<Array<number>>>}
 */
export async function generateLocalEmbeddingsBatch(texts, onProgress) {
  if (!texts || texts.length === 0) return [];

  if (onProgress) {
    onProgress({
      progress: 30,
      status: 'progress',
      file: '',
      label: 'Calculating vectors via server...'
    });
  }

  try {
    const res = await fetch(EMBEDDINGS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        texts,
        model: 'bge-m3'
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server embeddings returned status ${res.status}`);
    }

    const data = await res.json();

    if (onProgress) {
      onProgress({
        progress: 100,
        status: 'ready',
        file: '',
        label: 'Semantic index updated'
      });
    }

    return data.embeddings;
  } catch (err) {
    console.error("Failed to calculate embeddings via server:", err);
    throw err;
  }
}

/**
 * Generates a 1024-dimensional normalized vector for a given text chunk
 * @param {string} text - Plain text chunk to embed
 * @returns {Promise<Array<number>>} - Floating-point array vector of size 1024
 */
export async function generateLocalEmbedding(text) {
  const results = await generateLocalEmbeddingsBatch([text]);
  return results[0];
}
