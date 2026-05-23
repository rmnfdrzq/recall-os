import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText, Image as ImageIcon, FileCode, CheckCircle, Clock, AlertCircle,
  Search, Send, UploadCloud, Trash2, Plus, Sparkles, Folder,
  Link2, Settings, Download
} from 'lucide-react';
import { GlimmerSkeleton } from './components/LazyLoader';
import { initEmbeddingsEngine, generateLocalEmbedding, generateLocalEmbeddingsBatch } from './utils/embeddings';
import {
  computeTextHash,
  getCachedEmbedding,
  cacheEmbedding
} from './utils/embeddingsCache';
import {
  buildDocumentSummary,
  buildEnhancedContext,
  buildSmartChunks
} from './utils/documentIntelligence';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

const getStatusBadgeStyles = (status) => {
  switch (status) {
    case 'processed':
      return {
        bg: 'rgba(16,185,129,0.1)',
        color: '#34d399',
        icon: <CheckCircle size={10} />,
        label: 'processed'
      };
    case 'indexed_text':
      return {
        bg: 'rgba(96,165,250,0.1)',
        color: '#60a5fa',
        icon: <CheckCircle size={10} />,
        label: 'text indexed'
      };
    case 'indexing_vectors':
      return {
        bg: 'rgba(245,158,11,0.1)',
        color: '#fbbf24',
        icon: <Clock size={10} />,
        label: 'indexing vectors'
      };
    case 'processing':
      return {
        bg: 'rgba(245,158,11,0.1)',
        color: '#fbbf24',
        icon: <Clock size={10} />,
        label: 'processing'
      };
    default:
      return {
        bg: 'rgba(239,68,68,0.1)',
        color: '#f87171',
        icon: <AlertCircle size={10} />,
        label: status || 'failed'
      };
  }
};


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
const API_BASE = `${BACKEND_HOST}/api`;
const SERVER_PROCESS_ENDPOINT = `${API_BASE}/documents/process/`;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

const getFilename = (filePath) => filePath.split('/').pop() || filePath.split('\\').pop() || 'document';

const getExtension = (filename) => filename.split('.').pop()?.toLowerCase() || '';

const inferFileType = (filename) => {
  const extension = getExtension(filename);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  return 'text';
};

const normalizeLocalDocument = (doc) => {
  if (!doc) return {};
  return {
    id: doc.id || '',
    filename: doc.filename || '',
    file_type: doc.file_type || doc.fileType || '',
    status: doc.status || 'pending',
    summary: doc.summary || doc.description || '',
    suggested_title: doc.suggested_title || doc.suggestedTitle || doc.filename || '',
    category: doc.category || 'General',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    file_path: doc.file_path || doc.filePath || doc.file || '',
    created_at: doc.created_at || doc.createdAt || new Date().toISOString(),
    updated_at: doc.updated_at || doc.updatedAt || new Date().toISOString(),
    file: doc.file || doc.file_path || doc.filePath || '',
  };
};

const getFileUrl = (filePath) => {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  if (isDesktop() && (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath))) {
    return convertFileSrc(filePath, 'asset');
  }
  return `${BACKEND_HOST}${filePath}`;
};

const getPdfPreviewUrl = (filePath) => {
  const fileUrl = getFileUrl(filePath);
  if (!fileUrl) return '';
  return fileUrl;
};

const isMissingSummary = (summary) => {
  const normalized = (summary || '').trim().toLowerCase();
  return !normalized || [
    'no summary generated',
    'no summary generated.',
    'no summary synthesized',
    'no summary synthesized.'
  ].includes(normalized);
};

const getSummaryText = (doc) => {
  if (!doc) return '';
  if (!isMissingSummary(doc.summary)) {
    return doc.summary;
  }
  if (doc.status === 'pending' || doc.status === 'processing' || doc.status === 'indexing_vectors' || doc.status === 'indexed_text') {
    return 'AI summary is being generated as part of document processing.';
  }
  return 'AI summary has not been generated for this document yet.';
};

const isDebugMode = () => {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get('debug') === '1' ||
    params.get('debug') === 'true' ||
    localStorage.getItem('recallosDebug') === 'true' ||
    import.meta.env.VITE_RECALLOS_DEBUG === 'true'
  );
};

export default function App() {
  const debugMode = isDebugMode();

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('user_token'));

  // Offline Semantic Engine BGE-M3 States
  const [modelLoadingProgress, setModelLoadingProgress] = useState(0);
  const [modelLoadingLabel, setModelLoadingLabel] = useState('Preparing download');
  const [modelLoadingError, setModelLoadingError] = useState('');
  const [isModelReady, setIsModelReady] = useState(false);
  const [isModelDownloading, setIsModelDownloading] = useState(false);

  // Core Application State
  const [documents, setDocuments] = useState([]);
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Document Preview & Overlay Search States
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [selectedDocDetails, setSelectedDocDetails] = useState(null);
  const [isLoadingDocDetails, setIsLoadingDocDetails] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Loading & State Feedback
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [activeSourcePopov, setActiveSourcePopov] = useState(null); // referenced document detail popover

  // OCR & Local Workspace States
  const [isDragOver, setIsDragOver] = useState(false);
  const [chatInput, setChatInput] = useState('');

  // Settings & Theme States
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general'); // 'general' or 'account'

  // Refs
  const chatBottomRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isSendingMessage]);

  // Sync theme with DOM body class
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Remove legacy account state from earlier builds.
  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');

    // Force WebKit viewport repaint to avoid black/blank screen on startup
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
  }, []);

  const initLocalEngine = useCallback(async () => {
      // BGE-M3 only runs offline if we are in desktop/Tauri mode, 
      // but let's initialize it if isDesktop() is true.
      if (isDesktop()) {
        setIsModelDownloading(true);
        setModelLoadingError('');
        setModelLoadingProgress(1);
        setModelLoadingLabel('Preparing download');
        try {
          await initEmbeddingsEngine((event) => {
            const progress = typeof event === 'number' ? event : event?.progress;
            const label = typeof event === 'number' ? null : event?.label;
            setModelLoadingProgress(Number.isFinite(progress) ? progress : 1);
            if (label) setModelLoadingLabel(label);
          });
          setIsModelReady(true);
          setModelLoadingProgress(100);
          setModelLoadingLabel('Semantic engine ready');
        } catch (err) {
          console.error("Local BGE-M3 embeddings model failed to load:", err);
          setModelLoadingError(err?.message || 'Failed to download the local BGE-M3 model.');
        } finally {
          setIsModelDownloading(false);
        }
      } else {
        // Fallback for non-desktop browser mockup
        setIsModelReady(true);
      }
  }, []);

  // Initialize local embeddings engine BGE-M3 (React side)
  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      if (!isMounted) return;
      await initLocalEngine();
    };
    run();
    return () => {
      isMounted = false;
    };
  }, [initLocalEngine]);

  const refreshLocalDocuments = async () => {
    if (!isDesktop()) {
      setDocuments([]);
      return [];
    }

    const localDocs = await invoke('list_local_documents');
    const staleBgeFailures = localDocs.filter(doc =>
      doc.status === 'failed' &&
      String(doc.summary || '').includes('https://huggingface.co/BAAI/bge-m3/')
    );
    for (const staleDoc of staleBgeFailures) {
      try {
        await invoke('delete_local_document', { documentId: staleDoc.id });
      } catch (err) {
        console.warn("Failed to remove stale BGE-M3 download error document", err);
      }
    }

    const normalized = localDocs
      .filter(doc => !staleBgeFailures.some(staleDoc => staleDoc.id === doc.id))
      .map(normalizeLocalDocument);
    setDocuments(normalized);
    return normalized;
  };

  const saveLocalDocument = async (doc) => {
    const normalized = normalizeLocalDocument(doc);
    await invoke('upsert_local_document', { document: normalized });
    setDocuments(prev => {
      return [normalized, ...prev.filter(item => item.id !== normalized.id)];
    });
    if (selectedDocId === normalized.id) {
      setSelectedDocDetails(prev => normalizeLocalDocument({
        ...(prev || {}),
        ...normalized,
        chunks: prev?.chunks || []
      }));
    }
    return normalized;
  };

  const buildUploadFileFromPath = async (filePath) => {
    const localFile = await invoke('read_file_bytes', { path: filePath });
    const bytes = new Uint8Array(localFile.bytes);
    return new File([bytes], localFile.filename || getFilename(filePath), {
      type: 'application/octet-stream'
    });
  };

  const processFileOnServer = async (filePath, fileObject) => {
    console.log("🖥️ [Recall App] [Stage 1] processFileOnServer initiated:", { filePath, hasFileObject: !!fileObject });
    const formData = new FormData();
    const uploadFileObject = fileObject || await buildUploadFileFromPath(filePath);
    formData.append('file', uploadFileObject);

    console.log(`📤 [Recall App] [Stage 1] Sending POST to stateless server endpoint: ${SERVER_PROCESS_ENDPOINT}`);
    const startTime = Date.now();
    try {
      const res = await fetch(SERVER_PROCESS_ENDPOINT, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      const duration = Date.now() - startTime;
      if (!res.ok) {
        console.error(`❌ [Recall App] [Stage 1] Server OCR request failed after ${duration}ms:`, data.error || 'Server fallback processing failed');
        throw new Error(data.error || 'Server fallback processing failed');
      }
      console.log(`📥 [Recall App] [Stage 1] Server OCR response received successfully in ${duration}ms:`, {
        suggested_title: data.suggested_title,
        category: data.category,
        tags: data.tags,
        textLength: data.text?.length || 0,
        chunksCount: data.chunks?.length || 0
      });
      return data;
    } catch (err) {
      console.error(`❌ [Recall App] [Stage 1] Server OCR fallback request threw exception:`, err);
      throw err;
    }
  };

  const normalizeIndexedChunks = (filename, text, chunks = []) => {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return buildSmartChunks(text, { filename });
    }

    if (typeof chunks[0] === 'string') {
      return buildSmartChunks(chunks.join('\n\n'), { filename });
    }

    return chunks.map((chunk, index) => ({
      content: chunk.content || chunk.text || '',
      chunk_index: Number.isFinite(chunk.chunk_index) ? chunk.chunk_index : index,
      prev_chunk_index: index > 0 ? index - 1 : null,
      next_chunk_index: index < chunks.length - 1 ? index + 1 : null,
      page_number: chunk.page_number || 1,
      section_title: chunk.section_title || 'Document',
      section_index: chunk.section_index || 0,
      content_type: chunk.content_type || 'paragraph',
      keywords: Array.isArray(chunk.keywords) ? chunk.keywords : [],
      entities: chunk.entities || {},
      filename
    })).filter(chunk => chunk.content.trim());
  };

  const persistLocalChunks = async (documentId, filename, chunks) => {
    console.log(`🏎️ [Recall App] [Stage 2] persistLocalChunks called for document: ${documentId} ("${filename}") with ${chunks.length} chunks.`);
    const dbChunks = [];
    const chunksToEmbed = [];
    const chunkIndicesToEmbed = [];

    console.log("💾 [Recall App] [Stage 2] Checking IndexedDB local embeddings cache for duplicate chunks...");
    // Step 1: Query IndexedDB cache for every chunk hash
    for (let i = 0; i < chunks.length; i++) {
      const chunk = typeof chunks[i] === 'string'
        ? { content: chunks[i], chunk_index: i, filename }
        : chunks[i];
      const chunkTextContent = chunk.content || chunk.text || '';
      if (!chunkTextContent.trim()) continue;

      const hash = await computeTextHash(chunkTextContent);
      const cachedVector = await getCachedEmbedding(hash);
      
      console.log(`🔄 [Recall App] [Stage 2] Chunk [${i}] cache check: hash = ${hash}. Found in cache? ${!!cachedVector}`);

      dbChunks.push({
        id: `chunk-${documentId}-${i}`,
        document_id: documentId,
        text: chunkTextContent,
        vector: cachedVector,
        hash,
        metadata: {
          ...chunk,
          content: undefined,
          text: undefined,
          chunk_index: i,
          filename,
          created_at: new Date().toISOString()
        }
      });

      if (!cachedVector) {
        chunksToEmbed.push(chunkTextContent);
        chunkIndicesToEmbed.push(dbChunks.length - 1);
      }
    }

    const cachedHitsCount = dbChunks.length - chunksToEmbed.length;
    console.log(`📊 [Recall App] [Stage 2] Cache search finished. Total valid chunks: ${dbChunks.length}. Cache hits (reused): ${cachedHitsCount}. Cache misses (needs embedding): ${chunksToEmbed.length}.`);

    // Step 2: Compute remaining vectors in batches off main thread
    if (chunksToEmbed.length > 0) {
      console.log(`🛰️ [Recall App] [Stage 2] Dispatching ${chunksToEmbed.length} chunks to stateless server for batch embeddings generation using BGE-M3 model...`);
      const BATCH_SIZE = 16;
      const totalBatches = Math.ceil(chunksToEmbed.length / BATCH_SIZE);
      console.log(`📨 [Recall App] [Stage 2] Batch processing in chunks of size ${BATCH_SIZE}. Total batches: ${totalBatches}`);

      for (let offset = 0; offset < chunksToEmbed.length; offset += BATCH_SIZE) {
        const batchTexts = chunksToEmbed.slice(offset, offset + BATCH_SIZE);
        const batchIndices = chunkIndicesToEmbed.slice(offset, offset + BATCH_SIZE);
        const currentBatchNum = Math.floor(offset / BATCH_SIZE) + 1;

        console.log(`🚀 [Recall App] [Stage 2] Requesting server embeddings batch ${currentBatchNum}/${totalBatches}: offset = ${offset}, batch size = ${batchTexts.length}`);
        
        const startTime = Date.now();
        const batchVectors = await generateLocalEmbeddingsBatch(batchTexts);
        const duration = Date.now() - startTime;

        console.log(`📡 [Recall App] [Stage 2] Server embeddings batch ${currentBatchNum}/${totalBatches} response received in ${duration}ms. Received ${batchVectors.length} vectors.`);

        for (let j = 0; j < batchVectors.length; j++) {
          const dbChunkIndex = batchIndices[j];
          const vector = batchVectors[j];
          dbChunks[dbChunkIndex].vector = vector;

          if (vector) {
            // Save vector to IndexedDB cache for subsequent imports
            await cacheEmbedding(dbChunks[dbChunkIndex].hash, vector);
          }
        }
      }
      console.log(`💾 [Recall App] [Stage 2] All new vectors successfully computed and cached in IndexedDB.`);
    } else {
      console.log("♻️ [Recall App] [Stage 2] All chunks were found in cache! Zero server roundtrips required.");
    }

    // Map metadata to JSON strings for compatibility with Tauri / LanceDB
    const formattedDbChunks = dbChunks.map(chunk => ({
      id: chunk.id,
      document_id: chunk.document_id,
      text: chunk.text,
      vector: chunk.vector,
      metadata: JSON.stringify(chunk.metadata)
    }));

    console.log(`💾 [Recall App] [Stage 2] Writing all ${formattedDbChunks.length} chunks with BGE-M3 vectors to LanceDB via Tauri invoke('insert_document_chunks')...`);
    
    const dbStartTime = Date.now();
    await invoke('insert_document_chunks', {
      documentId: documentId,
      chunks: formattedDbChunks
    });
    
    console.log(`✅ [Recall App] [Stage 2] LanceDB insertion completed successfully in ${Date.now() - dbStartTime}ms.`);
  };

  // Initial local workspace data fetch
  useEffect(() => {
    let isMounted = true;

    const loadWorkspaceData = async () => {
      try {
        const docData = await refreshLocalDocuments();
        if (!isMounted) return;
        setDocuments(docData);

        const sessionRes = await fetch(`${API_BASE}/chat/session/`);
        const sessionData = await sessionRes.json();
        if (!isMounted) return;
        setChatSessions(sessionData);

        if (sessionData.length > 0) {
          const firstSessionId = sessionData[0].id;
          setActiveSessionId(firstSessionId);
          const detailRes = await fetch(`${API_BASE}/chat/session/${firstSessionId}/`);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (!isMounted) return;
            setChatMessages(detailData.messages || []);
          }
        } else {
          // Automatically create a default session if none exist
          const createRes = await fetch(`${API_BASE}/chat/session/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: 'Default Workspace Chat' })
          });
          if (createRes.ok) {
            const newSession = await createRes.json();
            if (!isMounted) return;
            setChatSessions([newSession]);
            setActiveSessionId(newSession.id);
            setChatMessages([
              { id: 'm-init', role: 'assistant', content: 'Hello! I am RecallOS AI. I have analyzed your documents in the local library. Ask me any question about them!', sources: [] }
            ]);
          }
        }
      } catch (err) {
        console.warn("Workspace initialization failed.", err);
      }
    };

    loadWorkspaceData();
    return () => {
      isMounted = false;
    };
  }, []);

  // File Ingestion & Local Indexing Handlers
  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      // In Tauri 2.0, dropped files expose their absolute path via file.path property!
      if (isDesktop() && file.path) {
        uploadLocalFile(file.path, file);
      } else {
        uploadFile(file);
      }
    }
  };

  const triggerUpload = async () => {
    if (isDesktop()) {
      try {
        const filePath = await invoke('select_local_file');
        if (filePath) {
          // Native file dialog does not return a JS File object, but we pass null and
          // let the pipeline index it locally + register it on the metadata server
          await uploadLocalFile(filePath, null);
        }
      } catch (err) {
        console.error("Native file select failed:", err);
        alert("Failed to open native dialog: " + err.message);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Try to get path if available (highly platform dependent for web inputs)
      if (isDesktop() && file.path) {
        uploadLocalFile(file.path, file);
      } else {
        uploadFile(file);
      }
    }
  };

  // Local-first, offline-ready document ingestion pipeline
  const uploadLocalFile = async (filePath, fileObject) => {
    setIsUploading(true);
    const filename = getFilename(filePath || fileObject?.name || 'document');
    const extension = getExtension(filename);
    const now = new Date().toISOString();
    const newDocId = `local-${Date.now()}`;

    console.log("📂 [Recall App] [Stage 0] File upload initiated:", { filePath, filename, extension, now, newDocId });

    try {
      // Stage 0: Initial record creation
      let localDoc = await saveLocalDocument({
        id: newDocId,
        filename,
        file_type: inferFileType(filename),
        status: 'processing',
        summary: '',
        suggested_title: filename,
        category: 'General',
        tags: [],
        file_path: filePath || '',
        created_at: now,
        updated_at: now
      });
      setSelectedDocId(newDocId);
      setSelectedDocDetails({
        ...localDoc,
        chunks: []
      });

      console.log("📝 [Recall App] [Stage 0] Initial document record registered in LanceDB:", localDoc);

      let text = '';
      let chunks = [];
      let metadata = {};
      const mustUseServerFallback = IMAGE_EXTENSIONS.has(extension);

      console.log("🔍 [Recall App] [Stage 1] Extracting text content. Server fallback required?", mustUseServerFallback);

      // Perform text extraction
      if (!mustUseServerFallback) {
        try {
          console.log("⚙️ [Recall App] [Stage 1] Parsing file locally via Tauri IPC invoke('parse_file')...");
          text = await invoke('parse_file', { path: filePath });
          
          console.log(`✅ [Recall App] [Stage 1] Local file parsing complete. Extracted ${text.length} characters.`);
          
          console.log(`🧩 [Recall App] [Stage 1] Building smart chunks locally...`);
          chunks = buildSmartChunks(text, { filename });
          
          console.log(`📦 [Recall App] [Stage 1] Chunks generated locally: ${chunks.length} chunks.`);

          if (!text.trim() || chunks.length === 0) {
            throw new Error("Extracted file content is empty or unsupported.");
          }
        } catch (localErr) {
          console.warn("⚠️ [Recall App] [Stage 1] Local parse/index failed or returned empty content; using stateless server OCR fallback.", localErr);
          text = '';
          chunks = [];
          metadata = await processFileOnServer(filePath, fileObject);
        }
      } else {
        console.log("🖥️ [Recall App] [Stage 1] File requires server-side handling (e.g. image OCR). Processing on server...");
        metadata = await processFileOnServer(filePath, fileObject);
      }

      if (metadata.text || metadata.chunks) {
        text = metadata.text || '';
        chunks = Array.isArray(metadata.chunks) && metadata.chunks.length > 0
          ? normalizeIndexedChunks(filename, text, metadata.chunks)
          : buildSmartChunks(text, { filename });
        
        console.log(`📦 [Recall App] [Stage 1] Received parsed content stats: character length = ${text.length}, chunk count = ${chunks.length}`);
        
        if (chunks.length === 0) {
          throw new Error("Server fallback did not return indexable text chunks.");
        }
      }

      // Stage 1: Document Text is Fully Extracted & Summary/Preview is Available!
      console.log("✍️ [Recall App] [Stage 1] Saving intermediate 'indexed_text' document status...");
      const indexedDoc = await saveLocalDocument({
        ...localDoc,
        status: 'indexed_text',
        summary: metadata.summary || localDoc.summary || buildDocumentSummary(filename, text, chunks),
        suggested_title: metadata.suggested_title || filename,
        category: metadata.category || 'General',
        tags: Array.isArray(metadata.tags) ? metadata.tags : ['AI-Ingested'],
        updated_at: new Date().toISOString()
      });

      console.log("✨ [Recall App] [Stage 1 Complete] Intermediate metadata & text preview saved:", indexedDoc);

      // INSTANTLY enable preview in the UI and allow user interaction!
      setSelectedDocId(newDocId);
      setSelectedDocDetails({
        ...indexedDoc,
        chunks: chunks.map((chunk, index) => ({
          id: `chunk-${newDocId}-${index}`,
          document_id: newDocId,
          content: chunk.content || chunk.text || '',
          chunk_index: index,
          metadata: JSON.stringify(chunk)
        }))
      });

      // Stop global loading spinner - UI is now fluid and ready!
      setIsUploading(false);

      // Stage 2: Background Vector Indexing
      console.log("⚡ [Recall App] [Stage 2] Starting background vector indexing pipeline. Status set to 'indexing_vectors'...");
      let indexingDoc = await saveLocalDocument({
        ...indexedDoc,
        status: 'indexing_vectors',
        updated_at: new Date().toISOString()
      });

      // Perform background batch embeddings calculation and persist to LanceDB
      await persistLocalChunks(newDocId, filename, chunks);

      // Stage 3: Indexing fully complete!
      console.log("🌟 [Recall App] [Stage 3] Completing indexing pipeline. Setting status to 'processed'...");
      const processedDoc = await saveLocalDocument({
        ...indexingDoc,
        status: 'processed',
        updated_at: new Date().toISOString()
      });

      // Refresh final details with chunks database links
      try {
        const detail = await invoke('get_local_document', { documentId: newDocId });
        if (selectedDocId === newDocId) {
          setSelectedDocDetails(normalizeLocalDocument(detail));
        }
      } catch {
        if (selectedDocId === newDocId) {
          setSelectedDocDetails({
            ...processedDoc,
            chunks: chunks.map((chunk, index) => ({
              id: `chunk-${newDocId}-${index}`,
              document_id: newDocId,
              content: chunk.content || chunk.text || '',
              chunk_index: index,
              metadata: JSON.stringify(chunk)
            }))
          });
        }
      }

      console.log(`🏆 [Recall App] [Stage 3 Complete] Document "${filename}" successfully indexed and processed locally in the background!`, processedDoc);
    } catch (err) {
      console.error("🔴 [Recall App] [Ingestion Error] Local document ingestion pipeline failed:", err);
      await saveLocalDocument({
        id: newDocId,
        filename,
        file_type: inferFileType(filename),
        status: 'failed',
        summary: err.message,
        suggested_title: filename,
        category: 'General',
        tags: [],
        file_path: filePath || '',
        created_at: now,
        updated_at: new Date().toISOString()
      });
      console.log("🚨 [Recall App] Document status set to 'failed'. Summary updated with error details.");
      alert("Failed to index local document: " + err.message);
      setIsUploading(false);
    }
  };

  // Browser mode cannot satisfy client-first LanceDB indexing because Rust IPC is unavailable.
  const uploadFile = async (file) => {
    alert(`Client-first indexing requires the desktop app. Could not index ${file?.name || 'this file'} in browser mode.`);
  };

  const handleSelectDocument = async (doc) => {
    setSelectedDocId(doc.id);
    setIsLoadingDocDetails(true);
    setSelectedDocDetails(null);

    try {
      if (isDesktop()) {
        const data = await invoke('get_local_document', { documentId: doc.id });
        setSelectedDocDetails(normalizeLocalDocument(data));
      } else {
        setSelectedDocDetails({
          ...doc,
          chunks: []
        });
      }
    } catch (err) {
      console.error("Error fetching doc details:", err);
      setSelectedDocDetails({
        ...doc,
        chunks: []
      });
    } finally {
      setIsLoadingDocDetails(false);
    }
  };

  const handleDeleteDoc = async (docId, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      if (isDesktop()) {
        await invoke('delete_local_document', { documentId: docId });
      }
      setDocuments(prev => prev.filter(d => d.id !== docId));
      if (selectedDocId === docId) {
        setSelectedDocId(null);
        setSelectedDocDetails(null);
      }
    } catch (err) {
      alert("Error deleting document: " + err.message);
    }
  };

  // Search API
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setShowSearchDropdown(true);

    if (isDesktop()) {
      try {
        // 1. Generate query vector using offline BGE-M3
        const queryVector = await generateLocalEmbedding(searchQuery);

        // 2. Invoke local LanceDB vector search command in Tauri
        const localResults = await invoke('search_local_vectors', {
          queryVector: queryVector,
          limit: 10
        });

        // 3. Map local results to what the frontend UI expects
        const mappedResults = localResults.map(item => {
          const matchingDoc = documents.find(d => d.id === item.document_id);
          // LanceDB L2 distance: score = 2 * (1 - cosine_similarity) for normalized vectors
          // similarity = 1 - (score / 2)
          const similarity = Math.max(0.1, Math.min(1.0, 1.0 - (item.score / 2.0)));
          return {
            id: item.id,
            document_id: item.document_id,
            category: matchingDoc?.category || 'General',
            suggested_title: matchingDoc?.suggested_title || matchingDoc?.filename || 'Document Chunk',
            filename: matchingDoc?.filename || 'document.pdf',
            similarity: similarity,
            content: item.text,
            metadata: item.metadata
          };
        });

        // 4. Sort local results by similarity descending
        mappedResults.sort((a, b) => b.similarity - a.similarity);

        setSearchResults(mappedResults);
      } catch (err) {
        console.error("Local semantic search failed:", err);
        alert("Local search error: " + err.message);
      } finally {
        setIsSearching(false);
      }
      return;
    }

    alert("Client-first semantic search requires the desktop app and local LanceDB index.");
    setIsSearching(false);
  };

  // Chat API
  const handleSelectSession = async (sessionId) => {
    setActiveSessionId(sessionId);

    try {
      const res = await fetch(`${API_BASE}/chat/session/${sessionId}/`);
      const data = await res.json();
      setChatMessages(data.messages || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/chat/session/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: `Chat Session #${chatSessions.length + 1}` })
      });
      if (!res.ok) throw new Error("Failed to create a new chat session");
      const data = await res.json();
      setChatSessions(prev => [data, ...prev]);
      handleSelectSession(data.id);
    } catch (err) {
      alert(err.message);
    }
  };

  const getLocalChatContext = async (query) => {
    if (!isDesktop()) return [];

    try {
      const queryVector = await generateLocalEmbedding(query);
      const localResults = await invoke('search_local_vectors', {
        queryVector,
        limit: 50
      });

      return await buildEnhancedContext({
        query,
        vectorResults: localResults,
        documents,
        fetchDocumentDetail: async (documentId) => {
          return await invoke('get_local_document', { documentId: documentId });
        },
        maxContextChars: 12000
      });
    } catch (err) {
      console.warn("Failed to build local chat context; sending message without document context.", err);
      return [];
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput.trim();
    setChatInput('');

    // Optimistic user message append
    const optimUserMsg = { id: `user-msg-${Date.now()}`, role: 'user', content: userText, sources: [] };
    setChatMessages(prev => [...prev, optimUserMsg]);
    setIsSendingMessage(true);

    try {
      let currentSessionId = activeSessionId;
      if (!currentSessionId) {
        const createRes = await fetch(`${API_BASE}/chat/session/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title: 'Default Workspace Chat' })
        });
        if (!createRes.ok) throw new Error("Failed to create a default chat session");
        const newSession = await createRes.json();
        setChatSessions([newSession]);
        setActiveSessionId(newSession.id);
        currentSessionId = newSession.id;
      }

      const contextChunks = await getLocalChatContext(userText);
      const res = await fetch(`${API_BASE}/chat/session/${currentSessionId}/message/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: userText, context_chunks: contextChunks })
      });
      if (!res.ok) throw new Error("Failed to append chat message");
      const data = await res.json();
      setChatMessages(prev => [...prev, data]);
    } catch (err) {
      console.error("Error sending message to RecallOS AI:", err);
      alert(err.message);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const getFileIcon = (type) => {
    switch (type) {
      case 'pdf':
        return <FileText size={20} className="text-red-400" style={{ color: '#f87171' }} />;
      case 'image':
        return <ImageIcon size={20} className="text-blue-400" style={{ color: '#60a5fa' }} />;
      case 'markdown':
        return <FileCode size={20} className="text-emerald-400" style={{ color: '#34d399' }} />;
      default:
        return <FileText size={20} className="text-gray-400" style={{ color: '#9ca3af' }} />;
    }
  };

  const renderPreviewFrame = (doc) => {
    if (!doc) return null;
    const fileUrl = getFileUrl(doc.file);

    switch (doc.file_type) {
      case 'pdf':
        return (
          <div style={{ width: '100%', height: 'clamp(680px, 78vh, 960px)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--panel-border)', background: 'var(--panel-bg-preview)', position: 'relative' }}>
            <object
              data={getPdfPreviewUrl(doc.file)}
              type="application/pdf"
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              aria-label={doc.filename}
            >
              <iframe
                src={getPdfPreviewUrl(doc.file)}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title={doc.filename}
              />
            </object>
          </div>
        );
      case 'image':
        return (
          <div style={{
            width: '100%',
            minHeight: '250px',
            maxHeight: '450px',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-bg-preview)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.6)'
          }}>
            <img
              src={fileUrl}
              alt={doc.filename}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
              }}
            />
          </div>
        );
      case 'markdown':
      case 'text':
      default:
        return (
          <div style={{
            padding: '2rem',
            borderRadius: '12px',
            border: '1px dashed var(--panel-border)',
            background: 'var(--surface-subtle)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
            margin: '1rem 0'
          }}>
            <div style={{
              background: 'rgba(52, 211, 153, 0.1)',
              padding: '1rem',
              borderRadius: '50%',
              display: 'flex',
              color: '#34d399'
            }}>
              <CheckCircle size={32} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Digitized Text Content</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                This {doc.file_type || 'text'} document has been fully OCR-digitized and indexed into 768-dimensional semantic embeddings.
              </p>
            </div>
          </div>
        );
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme === 'light' ? '#f8fafc' : '#0f172a',
        color: theme === 'light' ? '#1e293b' : '#f1f5f9',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div className="glass-panel" style={{
          width: '100%',
          maxWidth: '400px',
          padding: '2.5rem',
          background: theme === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(30, 41, 59, 0.9)',
          border: theme === 'light' ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: theme === 'light' ? '0 20px 40px rgba(0,0,0,0.06)' : '0 20px 40px rgba(0,0,0,0.3)',
          borderRadius: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.75rem',
          textAlign: 'center'
        }}>
          {/* Logo Brand */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              color: '#ffffff',
              padding: '1rem',
              borderRadius: '16px',
              display: 'flex',
              boxShadow: '0 10px 20px rgba(124, 58, 237, 0.25)'
            }}>
              <Sparkles size={36} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: '900', letterSpacing: '-0.03em', margin: 0, color: theme === 'light' ? '#111827' : '#ffffff' }}>
                RecallOS
              </h1>
              <p style={{ fontSize: '0.85rem', color: theme === 'light' ? '#64748b' : '#94a3b8', marginTop: '0.25rem' }}>
                Developer Authentication Portal
              </p>
            </div>
          </div>

          {/* Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const username = e.target.username.value.trim();
              const password = e.target.password.value.trim();

              if (username === 'admin' && password === 'admin') {
                localStorage.setItem('user_token', 'mock-jwt-admin-token');
                setIsAuthenticated(true);
              } else {
                alert("Invalid developer credentials! Use 'admin' / 'admin'.");
              }
            }}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="username" style={{ fontSize: '0.75rem', fontWeight: '700', color: theme === 'light' ? '#475569' : '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                defaultValue="admin"
                required
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: '1px solid var(--panel-border)',
                  background: 'var(--surface-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  outline: 'none',
                  transition: 'var(--transition-fast)'
                }}
                onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
                onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="password" style={{ fontSize: '0.75rem', fontWeight: '700', color: theme === 'light' ? '#475569' : '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                defaultValue="admin"
                required
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: '1px solid var(--panel-border)',
                  background: 'var(--surface-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  outline: 'none',
                  transition: 'var(--transition-fast)'
                }}
                onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
                onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
              />
            </div>

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.85rem',
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                fontWeight: '700',
                fontSize: '0.95rem',
                cursor: 'pointer',
                transition: 'var(--transition-smooth)',
                boxShadow: '0 4px 14px rgba(124, 58, 237, 0.25)',
                marginTop: '0.5rem'
              }}
              onMouseOver={(e) => e.target.style.transform = 'translateY(-1px)'}
              onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
            >
              Sign In
            </button>
          </form>

          {/* Footer Info */}
          <div style={{ fontSize: '0.75rem', color: theme === 'light' ? '#94a3b8' : '#64748b', borderTop: '1px solid var(--panel-border)', paddingTop: '1rem', width: '100%' }}>
            Dev Mode credentials: <strong>admin</strong> / <strong>admin</strong>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-grid">
      {(isModelDownloading || modelLoadingError) && !isModelReady && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: theme === 'light' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(15, 23, 42, 0.8)',
          backdropFilter: 'blur(20px)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          color: theme === 'light' ? '#1f2937' : '#f3f4f6'
        }}>
          <div className="glass-panel" style={{
            padding: '2.5rem',
            maxWidth: '450px',
            width: '100%',
            background: theme === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(30, 41, 59, 0.9)',
            border: theme === 'light' ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: theme === 'light' ? '0 20px 40px rgba(0,0,0,0.06)' : '0 20px 40px rgba(0,0,0,0.3)',
            borderRadius: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.25rem'
          }}>
            <div style={{
              background: modelLoadingError ? '#ef4444' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              color: '#ffffff',
              padding: '1rem',
              borderRadius: '16px',
              display: 'flex',
              boxShadow: modelLoadingError ? '0 10px 20px rgba(239, 68, 68, 0.2)' : '0 10px 20px rgba(124, 58, 237, 0.2)'
            }}>
              {modelLoadingError ? <AlertCircle size={28} /> : <Download size={28} className="animate-bounce" />}
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', marginBottom: '0.5rem', color: theme === 'light' ? '#111827' : '#f9fafb' }}>
                {modelLoadingError ? 'Semantic Engine Download Failed' : 'Downloading Semantic Engine'}
              </h2>
              <p style={{ fontSize: '0.875rem', color: theme === 'light' ? '#4b5563' : '#9ca3af', lineHeight: '1.5' }}>
                {modelLoadingError || 'We are configuring the local multilingual BGE-M3 model for fully offline semantic search (~560 MB). This only happens once.'}
              </p>
            </div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: '700', color: modelLoadingError ? '#ef4444' : '#7c3aed' }}>
                <span>{modelLoadingError ? 'Check connection and retry' : modelLoadingLabel}</span>
                <span>{modelLoadingProgress}%</span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                background: theme === 'light' ? '#e5e7eb' : '#334155',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${modelLoadingProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(to right, #7c3aed, #4f46e5)',
                  transition: 'width 0.2s ease-out',
                  borderRadius: '4px'
                }} />
              </div>
              {modelLoadingError && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={initLocalEngine}
                  style={{ alignSelf: 'center', marginTop: '1rem' }}
                >
                  Retry Download
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 1. Left Panel: Library & Ingestion */}
      <aside className="glass-panel" style={{
        margin: '0.75rem', marginRight: '0', display: 'flex', flexDirection: 'column',
        height: 'calc(100vh - 1.5rem)', overflow: 'hidden'
      }}>
        {/* Logo and Brand */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ background: 'var(--accent-gradient)', padding: '0.4rem', borderRadius: '8px', display: 'flex' }}>
              <Sparkles size={16} color="#fff" />
            </div>
            <span style={{ fontWeight: '800', letterSpacing: '-0.02em', fontSize: '1.1rem' }}>RecallOS</span>
          </div>

        </div>

        {/* Drag and Drop File Area */}
        <div style={{ padding: '1rem' }}>
          <div
            onClick={triggerUpload}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleFileDrop}
            style={{
              padding: '1.25rem', border: `1px dashed ${isDragOver ? '#7c3aed' : 'var(--panel-border)'}`,
              borderRadius: '10px', background: isDragOver ? 'rgba(124,58,237,0.06)' : 'var(--surface-subtle)',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: '0.5rem', transition: 'var(--transition-smooth)'
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown"
            />
            {isUploading ? (
              <>
                <div className="skeleton-glimmer w-8 h-8 rounded-full bg-white/[0.05]" />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Uploading & Processing...</span>
              </>
            ) : (
              <>
                <UploadCloud size={28} style={{ color: '#a78bfa' }} />
                <div style={{ fontSize: '0.8rem', fontWeight: '600' }}>Upload File</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>PDF, Images, Text, MD</div>
              </>
            )}
          </div>
        </div>

        {/* Documents Library Explorer */}
        <div style={{ padding: '0 1rem 0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Folder size={16} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Library ({documents.length})
          </span>
        </div>

        {/* Library Scrollable Area */}
        <div style={{ flex: '1', overflowY: 'auto', padding: '0 1rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {isUploading && <GlimmerSkeleton count={1} />}
          {documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No documents yet. Drag & drop a file here!
            </div>
          ) : (
            documents.map(doc => (
              <div
                key={doc.id}
                onClick={() => handleSelectDocument(doc)}
                className="glass-panel"
                style={{
                  padding: '0.85rem', cursor: 'pointer', position: 'relative',
                  border: selectedDocId === doc.id ? '1px solid #7c3aed' : '1px solid var(--panel-border)',
                  background: selectedDocId === doc.id ? 'rgba(124,58,237,0.08)' : 'var(--surface-subtle)',
                  boxShadow: selectedDocId === doc.id ? '0 0 12px rgba(124,58,237,0.2)' : 'none',
                  transition: 'var(--transition-smooth)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                  <div style={{ marginTop: '0.15rem' }}>
                    {getFileIcon(doc.file_type)}
                  </div>
                  <div style={{ flex: '1', minWidth: '0' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.filename}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.4rem' }}>
                      {doc.category && (
                        <span style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(124,58,237,0.12)', color: '#a78bfa', fontWeight: '600' }}>
                          {doc.category}
                        </span>
                      )}

                      {(() => {
                        const badge = getStatusBadgeStyles(doc.status);
                        return (
                          <span style={{
                            fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: '4px',
                            background: badge.bg,
                            color: badge.color,
                            display: 'flex', alignItems: 'center', gap: '0.2rem'
                          }}>
                            {badge.icon}
                            {badge.label}
                          </span>
                        );
                      })()}
                    </div>

                    {doc.summary && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.5rem', lineBreak: 'anywhere', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {doc.summary}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => handleDeleteDoc(doc.id, e)}
                  style={{
                    position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer', padding: '0.25rem', borderRadius: '4px'
                  }}
                  onMouseOver={(e) => e.target.style.color = '#f87171'}
                  onMouseOut={(e) => e.target.style.color = 'var(--text-muted)'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Local workspace footer */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)', background: 'var(--surface-inset)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '0' }}>
            <div style={{ background: 'var(--surface-muted)', padding: '0.4rem', borderRadius: '50%', display: 'flex' }}>
              <Folder size={16} style={{ color: 'var(--text-secondary)' }} />
            </div>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Local Workspace
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={() => {
                setIsSettingsOpen(true);
              }}
              style={{
                background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer',
                display: 'flex', padding: '0.4rem', borderRadius: '8px', transition: 'var(--transition-fast)'
              }}
              onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              title="Settings"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* 2. Central Panel: Natural Semantic Search & Discovery */}
      <main style={{
        margin: '0.75rem', display: 'flex', flexDirection: 'column',
        height: 'calc(100vh - 1.5rem)', overflow: 'hidden'
      }}>
        {/* Floating Context Search Container */}
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '0.75rem', background: 'var(--panel-bg-heavy)' }}>
          <form onSubmit={handleSearch} className="search-container-glow" style={{ display: 'flex', width: '100%' }}>
            <div style={{ position: 'relative', flex: '1', display: 'flex', alignItems: 'center' }}>
              <Search size={18} style={{ position: 'absolute', left: '1rem', color: 'var(--text-secondary)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ask about anything, e.g.: 'Kubernetes node status' or 'README.md summary'..."
                style={{
                  width: '100%', padding: '0.85rem 1rem 0.85rem 2.75rem', borderRadius: '9999px',
                  background: 'var(--surface-muted)', border: '1px solid var(--panel-border)',
                  color: 'var(--text-primary)', fontSize: '0.95rem', outline: 'none', transition: 'var(--transition-smooth)'
                }}
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              style={{
                marginLeft: '0.5rem', padding: '0.85rem 1.5rem', borderRadius: '9999px',
                boxShadow: 'none'
              }}
            >
              <span>Search</span>
            </button>
          </form>
        </div>

        {/* Lower Container Area with Relative Position for Overlay */}
        <div style={{ flex: '1', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {/* Main Content Area (Welcome Placeholder or Document Preview Window) */}
          <div className="glass-panel" style={{
            flex: '1', display: 'flex', flexDirection: 'column', overflowY: 'auto',
            padding: '1.25rem', background: 'var(--panel-bg-heavy)', height: '100%'
          }}>
            {isLoadingDocDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '800', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sparkles size={18} className="animate-pulse-glow" style={{ color: '#a78bfa' }} />
                  <span>Loading Document...</span>
                </h2>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
                  <GlimmerSkeleton count={3} />
                </div>
              </div>
            ) : selectedDocDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                      {selectedDocDetails.filename}
                    </h2>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Uploaded {new Date(selectedDocDetails.created_at).toLocaleString('en-US')}
                      </span>
                      {selectedDocDetails.category && (
                        <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(124,58,237,0.12)', color: '#a78bfa', fontWeight: '600' }}>
                          {selectedDocDetails.category}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedDocId(null); setSelectedDocDetails(null); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                  >
                    Close Preview
                  </button>
                </div>

                {/* Tags */}
                {selectedDocDetails.tags && selectedDocDetails.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {selectedDocDetails.tags.map((tag, tIdx) => (
                      <span key={tIdx} style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', background: 'var(--chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--chip-border)' }}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* AI Summary */}
                <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '800', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Sparkles size={14} />
                      <span>AI Synthesized Summary</span>
                    </h3>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: '1.45' }}>
                    {getSummaryText(selectedDocDetails)}
                  </p>
                </div>

                {/* Dynamic Preview Frame */}
                {renderPreviewFrame(selectedDocDetails)}

                {/* Document Chunks */}
                {debugMode && selectedDocDetails.chunks && selectedDocDetails.chunks.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Debug: Indexed Text Portions ({selectedDocDetails.chunks.length})
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {selectedDocDetails.chunks.map((chunk, cIdx) => (
                        <div key={cIdx} style={{ padding: '0.85rem', background: 'var(--surface-subtle)', border: '1px solid var(--panel-border)', borderRadius: '8px' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: '600' }}>
                            Paragraph #{chunk.chunk_index + 1}
                          </div>
                          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                            {chunk.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Welcome / Empty Preview Placeholder */
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: 'var(--text-muted)', textAlign: 'center', gap: '1rem'
              }}>
                <div style={{
                  background: 'var(--surface-muted)',
                  padding: '1.5rem',
                  borderRadius: '50%',
                  border: '1px solid var(--panel-border)',
                  color: '#a78bfa',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                }}>
                  <Folder size={48} style={{ opacity: '0.8' }} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                    Document Preview Space
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '360px', margin: '0 auto', lineHeight: '1.4' }}>
                    Select a document from your library on the left to review its content, premium OCR extraction text, and AI synthesized summary.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Semantic Search Results Overlay Dropdown */}
          {showSearchDropdown && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 10,
              background: 'var(--panel-bg-overlay)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid var(--panel-border)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
              animation: 'fadeIn 0.2s ease-out'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                  <Sparkles size={18} style={{ color: '#a78bfa' }} />
                  <span>Semantic Search Results</span>
                </h2>
                <button
                  onClick={() => setShowSearchDropdown(false)}
                  className="btn-secondary"
                  style={{
                    padding: '0.4rem 0.85rem',
                    fontSize: '0.8rem',
                    borderRadius: '8px',
                    border: '1px solid var(--panel-border)',
                    background: 'var(--surface-muted)'
                  }}
                >
                  Close Results
                </button>
              </div>

              {/* Overlay scrollable results list */}
              <div style={{ flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {isSearching ? (
                  <GlimmerSkeleton count={2} />
                ) : searchResults.length === 0 ? (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', color: 'var(--text-muted)', textAlign: 'center', gap: '0.75rem'
                  }}>
                    <Search size={40} style={{ opacity: '0.4' }} />
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                        No results found
                      </div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                        Try another keyword or naturally phrased query.
                      </div>
                    </div>
                  </div>
                ) : (
                  searchResults.map((res, idx) => (
                    <div
                      key={idx}
                      className="glass-panel"
                      style={{
                        padding: '1rem', background: 'var(--surface-subtle)',
                        border: '1px solid var(--panel-border)', position: 'relative',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        const matchingDoc = documents.find(d => d.id === res.document_id);
                        if (matchingDoc) {
                          handleSelectDocument(matchingDoc);
                          setShowSearchDropdown(false);
                        }
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                        <div>
                          <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(124,58,237,0.12)', color: '#a78bfa', fontWeight: '700', marginRight: '0.5rem' }}>
                            {res.category || 'General'}
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                            {res.filename}
                          </span>
                        </div>

                        {/* Similarity Indicator Bar */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: '800', color: '#34d399' }}>
                            {Math.round(res.similarity * 100)}% Match
                          </span>
                          <div style={{ width: '60px', height: '4px', background: 'var(--surface-muted)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${res.similarity * 100}%`, height: '100%',
                              background: 'linear-gradient(to right, #10b981, #34d399)'
                            }} />
                          </div>
                        </div>
                      </div>

                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4', background: 'var(--surface-inset)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #7c3aed' }}>
                        {res.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 3. Right Panel: Contextual AI Workspace Chat */}
      <aside className="glass-panel" style={{
        margin: '0.75rem', marginLeft: '0', display: 'flex', flexDirection: 'column',
        height: 'calc(100vh - 1.5rem)', overflow: 'hidden', background: 'var(--panel-bg-heavy)'
      }}>
        {/* Chat Header */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Sparkles size={18} style={{ color: '#a78bfa' }} />
            <span style={{ fontWeight: '700', fontSize: '1rem' }}>Intellectual Chat</span>
          </div>

          <button
            onClick={handleCreateSession}
            style={{
              background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', fontWeight: '700'
            }}
          >
            <Plus size={14} />
            <span>New</span>
          </button>
        </div>

        {/* Message History List */}
        <div style={{ flex: '1', overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {chatMessages.map((msg, idx) => (
            <div
              key={msg.id || idx}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem'
              }}
            >
              <div
                className="glass-panel"
                style={{
                  padding: '0.85rem 1.1rem',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user' ? 'var(--accent-gradient)' : 'var(--surface-muted)',
                  border: msg.role === 'user' ? 'none' : '1px solid var(--panel-border)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                  boxShadow: msg.role === 'user' ? '0 4px 14px var(--accent-glow)' : 'none'
                }}
              >
                <p style={{ fontSize: '0.88rem', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </p>
              </div>

              {/* Source chips references inside the chat messages */}
              {msg.sources && msg.sources.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.15rem' }}>
                  {msg.sources.map((src, sIdx) => (
                    <div
                      key={sIdx}
                      style={{ position: 'relative' }}
                      onMouseEnter={() => setActiveSourcePopov(`${idx}-${sIdx}`)}
                      onMouseLeave={() => setActiveSourcePopov(null)}
                    >
                      <span style={{
                        fontSize: '0.62rem', padding: '0.2rem 0.5rem', borderRadius: '9999px',
                        background: 'var(--chip-bg)', border: '1px solid var(--chip-border)',
                        color: 'var(--text-secondary)', cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: '0.25rem'
                      }}>
                        <Link2 size={8} />
                        {src.filename}
                      </span>

                      {/* Floating hover popover */}
                      {activeSourcePopov === `${idx}-${sIdx}` && (
                        <div className="glass-panel" style={{
                          position: 'absolute', bottom: '1.5rem', left: '0', zIndex: 100,
                          width: '280px', padding: '0.75rem', background: 'var(--panel-bg-solid)',
                          borderRadius: '8px', border: '1px solid var(--panel-border)',
                          boxShadow: '0 10px 25px rgba(0,0,0,0.5)', cursor: 'default'
                        }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: '800', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <FileText size={12} color="#a78bfa" />
                            <span>{src.filename} (Chunk {src.chunk_index})</span>
                          </div>
                          <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
                            "{src.snippet}"
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {isSendingMessage && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <div className="skeleton-glimmer w-8 h-8 rounded-full bg-white/[0.04]" />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} className="animate-pulse-glow">AI is thinking...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Input Bar */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)' }}>
          <form onSubmit={handleSendMessage} style={{ display: 'flex', width: '100%', gap: '0.5rem' }}>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask AI about your uploaded data..."
              style={{
                flex: '1', padding: '0.75rem 1rem', borderRadius: '10px',
                background: 'var(--surface-muted)', border: '1px solid var(--panel-border)',
                color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', transition: 'var(--transition-smooth)'
              }}
            />
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '0.75rem', borderRadius: '10px' }}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </aside>

      {/* 4. Settings Overlay Modal */}
      {isSettingsOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(11, 15, 26, 0.6)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          padding: '1.5rem',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '640px',
            background: 'var(--modal-bg)',
            border: '1px solid var(--panel-border)',
            borderRadius: '20px',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Settings size={22} style={{ color: '#a78bfa' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  Workspace Settings
                </h2>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600'
                }}
                onMouseOver={(e) => e.target.style.color = 'var(--text-primary)'}
                onMouseOut={(e) => e.target.style.color = 'var(--text-secondary)'}
              >
                Close
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
              <button
                onClick={() => setSettingsTab('general')}
                style={{
                  background: settingsTab === 'general' ? 'rgba(124, 58, 237, 0.12)' : 'none',
                  border: 'none',
                  color: settingsTab === 'general' ? '#a78bfa' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0.5rem 1.25rem',
                  borderRadius: '8px',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  transition: 'var(--transition-fast)'
                }}
              >
                General Settings
              </button>
              <button
                onClick={() => setSettingsTab('account')}
                style={{
                  background: settingsTab === 'account' ? 'rgba(124, 58, 237, 0.12)' : 'none',
                  border: 'none',
                  color: settingsTab === 'account' ? '#a78bfa' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0.5rem 1.25rem',
                  borderRadius: '8px',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  transition: 'var(--transition-fast)'
                }}
              >
                Developer Account
              </button>
            </div>

            {/* Content Tab conditional views */}
            <div style={{ flex: '1', overflowY: 'auto', maxHeight: '420px', paddingRight: '0.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {settingsTab === 'general' && (
                <>
                  {/* Theme Switcher section */}
                  <div>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Appearance / Theme
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      {/* Dark Mode selection card */}
                      <div
                        onClick={() => setTheme('dark')}
                        className="glass-panel"
                        style={{
                          padding: '1.25rem',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '0.5rem',
                          border: theme === 'dark' ? '2px solid #7c3aed' : '1px solid var(--panel-border)',
                          background: theme === 'dark' ? 'rgba(124, 58, 237, 0.08)' : 'var(--surface-subtle)',
                          boxShadow: theme === 'dark' ? '0 0 16px rgba(124, 58, 237, 0.25)' : 'none',
                          transition: 'var(--transition-smooth)',
                          borderRadius: '12px'
                        }}
                      >
                        <div style={{
                          background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                          width: '40px', height: '40px', borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                          <Sparkles size={18} color="#a78bfa" />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: '700', color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Dark Mode</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Futuristic Deep Space</span>
                      </div>

                      {/* Light Mode selection card */}
                      <div
                        onClick={() => setTheme('light')}
                        className="glass-panel"
                        style={{
                          padding: '1.25rem',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '0.5rem',
                          border: theme === 'light' ? '2px solid #6366f1' : '1px solid var(--panel-border)',
                          background: theme === 'light' ? 'rgba(99, 102, 241, 0.08)' : 'var(--surface-subtle)',
                          boxShadow: theme === 'light' ? '0 0 16px rgba(99, 102, 241, 0.25)' : 'none',
                          transition: 'var(--transition-smooth)',
                          borderRadius: '12px'
                        }}
                      >
                        <div style={{
                          background: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)',
                          width: '40px', height: '40px', borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '1px solid rgba(0,0,0,0.05)'
                        }}>
                          <Sparkles size={18} color="#4f46e5" />
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: '700', color: theme === 'light' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Light Mode</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Minimalist Crisp Violet</span>
                      </div>
                    </div>
                  </div>

                  {/* System Diagnostics section */}
                  <div className="glass-panel" style={{ padding: '1rem', background: 'var(--surface-subtle)', border: '1px solid var(--panel-border)', borderRadius: '12px' }}>
                    <h3 style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Diagnostics & Status
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Workspace Mode</span>
                        <span style={{ fontWeight: '600', color: '#10b981' }}>Local Connected OS</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Embedding Engine</span>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>BGE-M3 local</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Vector Database</span>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>LanceDB local (1024d)</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'account' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      User Credentials
                    </h3>
                    <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: '1px solid var(--panel-border)', background: 'var(--surface-subtle)', borderRadius: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>Logged in as: admin</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Dev Mode Bypass Authentication</div>
                        </div>
                        <span style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(124, 58, 237, 0.15)', color: '#a78bfa', fontWeight: '700' }}>
                          DEVELOPER
                        </span>
                      </div>
                      
                      <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1rem', marginTop: '0.25rem' }}>
                        <button
                          onClick={() => {
                            localStorage.removeItem('user_token');
                            setIsAuthenticated(false);
                            setIsSettingsOpen(false);
                          }}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            transition: 'var(--transition-smooth)',
                            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)'
                          }}
                          onMouseOver={(e) => e.target.style.opacity = '0.9'}
                          onMouseOut={(e) => e.target.style.opacity = '1'}
                        >
                          Sign Out of RecallOS
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="btn-primary"
                style={{ padding: '0.65rem 1.5rem', borderRadius: '10px' }}
              >
                <span>Save & Dismiss</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
