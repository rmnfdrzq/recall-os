import { BACKEND_HOST } from "../lib/appConfig";

const EMBEDDINGS_ENDPOINT = `${BACKEND_HOST}/api/embeddings/`;

/**
 * Calculates high-dimensional vector embeddings for a list of text strings in batch
 * using the stateless server API backed by host Ollama.
 * @param {Array<string>} texts - List of text chunks to calculate embeddings for
 * @param {Function} [onProgress] - Optional progress callback
 * @returns {Promise<Array<Array<number>>>}
 */
export async function generateServerEmbeddingsBatch(texts, onProgress) {
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

export async function generateServerEmbedding(text) {
  const results = await generateServerEmbeddingsBatch([text]);
  return results[0];
}
