import { pipeline, env } from '@huggingface/transformers';

// Configure transformers env to use standard CDN endpoints and cache paths
env.allowLocalModels = false; // Set false to fetch from Hugging Face Hub directly
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 4; // Use multi-threading for faster ONNX calculations

let extractor = null;
const MODEL_NAME = 'Xenova/bge-m3';

const formatModelFile = (file = '') => {
  if (file.includes('model') && file.endsWith('.onnx')) return 'ONNX Weights';
  if (file.includes('tokenizer')) return 'Tokenizer';
  if (file.includes('config')) return 'Model Config';
  return file || 'Model Files';
};

const emitProgress = (progress, status = 'progress', file = '', label = '') => {
  self.postMessage({
    type: 'progress',
    payload: {
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0,
      status,
      file,
      label: label || formatModelFile(file)
    }
  });
};

/**
 * Initializes and downloads the BGE-M3 quantized INT8 model
 */
async function initEngine() {
  if (extractor) {
    self.postMessage({ type: 'ready' });
    return extractor;
  }

  emitProgress(1, 'download', '', 'Preparing download');

  extractor = await pipeline('feature-extraction', MODEL_NAME, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (data) => {
      if (data.status === 'progress_total') {
        emitProgress(data.progress, 'progress', data.file, 'Downloading model files');
        return;
      }

      if (data.status === 'download') {
        emitProgress(1, 'download', data.file, `Downloading ${formatModelFile(data.file)}`);
        return;
      }

      if (data.status === 'progress') {
        emitProgress(data.progress, 'progress', data.file, `Downloading ${formatModelFile(data.file)}`);
      }
    }
  });

  self.postMessage({ type: 'ready' });
  return extractor;
}

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    try {
      await initEngine();
    } catch (err) {
      self.postMessage({ type: 'error', error: err?.message || 'Failed to initialize BGE-M3 model in worker.' });
    }
  } else if (type === 'embed') {
    const { texts, id } = payload;
    try {
      if (!extractor) {
        await initEngine();
      }

      if (!texts || !Array.isArray(texts) || texts.length === 0) {
        self.postMessage({ type: 'embed_result', payload: { vectors: [], id } });
        return;
      }

      // Batch embeddings calculation
      const output = await extractor(texts, {
        pooling: 'mean',
        normalize: true
      });

      const batchSize = texts.length;
      const dim = 1024; // BGE-M3 vector dimension
      const flatData = output.data;
      const vectors = [];

      for (let i = 0; i < batchSize; i++) {
        const start = i * dim;
        const end = start + dim;
        const vector = Array.from(flatData.subarray(start, end));
        vectors.push(vector);
      }

      self.postMessage({ type: 'embed_result', payload: { vectors, id } });
    } catch (err) {
      self.postMessage({ type: 'error', error: err?.message || 'Failed to calculate batch embeddings in worker.', id });
    }
  }
};
