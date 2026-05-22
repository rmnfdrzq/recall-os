import { useState, useEffect, useRef } from 'react';
import {
  FileText, Image as ImageIcon, FileCode, CheckCircle, Clock, AlertCircle,
  Search, Send, UploadCloud, Trash2, Plus, Sparkles, Folder,
  Link2, Settings
} from 'lucide-react';
import { GlimmerSkeleton } from './components/LazyLoader';

const getBackendHost = () => {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8000';
  }
  return `${window.location.protocol}//${hostname}:8000`;
};

const BACKEND_HOST = getBackendHost();
const API_BASE = `${BACKEND_HOST}/api`;

const DEFAULT_MODELS = [
  { name: 'qwen2.5:1.5b', size: '986 MB', description: 'Default lightweight LLM — fast & memory-efficient.', installed: true, is_default: true },
  { name: 'qwen3.5:4b', size: '2.6 GB', description: 'Balanced medium-sized model for complex reasoning.', installed: true, is_default: false },
  { name: 'gemma4:e2b', size: '1.6 GB', description: "Google's Gemma E2B optimized variant.", installed: true, is_default: false }
];

const normalizeModelName = (modelName) => {
  if (modelName === 'qwen2.5:7b-instruct') return 'qwen3.5:4b';
  return DEFAULT_MODELS.some(model => model.name === modelName) ? modelName : 'qwen2.5:1.5b';
};

const getFileUrl = (filePath) => {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  return `${BACKEND_HOST}${filePath}`;
};

export default function App() {
  // Core Application State
  const [documents, setDocuments] = useState([]);
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCategory] = useState('');

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
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general'); // 'general' or 'models'
  const [activeModel, setActiveModel] = useState(normalizeModelName(localStorage.getItem('activeModel') || 'qwen2.5:1.5b'));
  const [modelsList, setModelsList] = useState(DEFAULT_MODELS);
  const [downloadingModel, setDownloadingModel] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);

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
  }, []);

  // Sync active model with localStorage
  useEffect(() => {
    localStorage.setItem('activeModel', activeModel);
  }, [activeModel]);

  const fetchModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/models/`);
      if (res.ok) {
        const data = await res.json();
        // API returns { models: [...] } wrapper object
        const nextModels = Array.isArray(data) ? data : (data.models || []);
        setModelsList(nextModels.length > 0 ? nextModels : DEFAULT_MODELS);
      }
    } catch (err) {
      console.warn("Failed to fetch models from local backend", err);
    }
  };

  const handleDownloadModel = async (modelName) => {
    if (downloadingModel) return;

    try {
      const response = await fetch(`${API_BASE}/models/pull/?model=${modelName}`);

      if (!response.ok) throw new Error("Backend download stream closed unexpectedly");

      setDownloadingModel(modelName);
      setDownloadProgress(0);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const data = JSON.parse(jsonStr);
              if (data.error) {
                console.error("Ollama pull error:", data.error);
                alert(`Download failed: ${data.error}`);
                setDownloadingModel(null);
                setDownloadProgress(null);
                return;
              }
              if (data.status === 'success') {
                setDownloadProgress(100);
                setTimeout(() => {
                  setDownloadingModel(null);
                  setDownloadProgress(null);
                  fetchModels();
                }, 1000);
                return;
              }
              if (data.completed && data.total) {
                const percentage = Math.round((data.completed / data.total) * 100);
                setDownloadProgress(percentage);
              }
            } catch (e) {
              console.debug("Error parsing SSE line", e);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error pulling model", err);
      alert(`Connection failed: ${err.message || 'Check Ollama server'}`);
      setDownloadingModel(null);
      setDownloadProgress(null);
    }
  };

  const handleActivateModel = (modelName) => {
    const model = modelsList.find(m => m.name === modelName);
    if (model && model.installed) {
      setActiveModel(modelName);
    } else {
      alert("Please download the model before activating.");
    }
  };

  const handleDeleteModel = async (modelName) => {
    if (modelName === 'qwen2.5:1.5b' && activeModel === 'qwen2.5:1.5b') {
      alert("Cannot delete the default active model.");
      return;
    }
    if (activeModel === modelName) {
      alert("Cannot delete the currently active model. Switch to another model first.");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${modelName}?`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/models/delete/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: modelName })
      });
      if (res.ok) {
        await fetchModels();
      } else {
        const err = await res.json();
        alert(`Failed to delete model: ${err.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("Error deleting model", err);
      alert("Failed to connect to backend to delete model.");
    }
  };

  // Initial local workspace data fetch
  useEffect(() => {
    let isMounted = true;

    const loadWorkspaceData = async () => {
      try {
        const docRes = await fetch(`${API_BASE}/documents/`);
        if (!docRes.ok) throw new Error("Backend unreachable");

        const docData = await docRes.json();
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
        await fetchModels();
      } catch (err) {
        console.warn("Django backend is unavailable.", err);
      }
    };

    loadWorkspaceData();
    return () => {
      isMounted = false;
    };
  }, []);

  // File Upload Handlers
  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  };

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFile(files[0]);
    }
  };

  const uploadFile = async (file) => {
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/documents/`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error("Failed to upload document");

      const newDoc = await res.json();
      setDocuments(prev => [newDoc, ...prev]);

      // Periodically poll document list to check status transition
      const interval = setInterval(async () => {
        const pollRes = await fetch(`${API_BASE}/documents/${newDoc.id}/`);
        const updatedDoc = await pollRes.json();
        if (updatedDoc.status === 'processed' || updatedDoc.status === 'failed') {
          clearInterval(interval);
          setDocuments(prev => prev.map(d => d.id === newDoc.id ? updatedDoc : d));
        }
      }, 3000);

    } catch (err) {
      alert(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectDocument = async (doc) => {
    setSelectedDocId(doc.id);
    setIsLoadingDocDetails(true);
    setSelectedDocDetails(null);

    try {
      const res = await fetch(`${API_BASE}/documents/${doc.id}/`);
      if (!res.ok) throw new Error("Failed to fetch document details");
      const data = await res.json();
      setSelectedDocDetails(data);
    } catch (err) {
      console.error("Error fetching doc details:", err);
      // Fallback to basic info if chunks retrieval failed
      setSelectedDocDetails({
        ...doc,
        chunks: [{ id: 'fallback-chunk', chunk_index: 0, content: doc.summary || doc.filename }]
      });
    } finally {
      setIsLoadingDocDetails(false);
    }
  };

  const handleDeleteDoc = async (docId, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      const res = await fetch(`${API_BASE}/documents/${docId}/`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== docId));
      }
    } catch (err) {
      alert("Error deleting document: " + err.message);
    }
  };

  // Search API
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setShowSearchDropdown(true);

    try {
      const res = await fetch(`${API_BASE}/search/semantic/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: searchQuery, category: selectedCategory })
      });

      if (!res.ok) throw new Error("Search execution failed");
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsSearching(false);
    }
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

      const res = await fetch(`${API_BASE}/chat/session/${currentSessionId}/message/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: userText, model: activeModel })
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
          <div style={{ width: '100%', height: '450px', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--panel-border)', background: 'var(--panel-bg-preview)', position: 'relative' }}>
            <iframe
              src={fileUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title={doc.suggested_title || doc.filename}
            />
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
              alt={doc.suggested_title || doc.filename}
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

  return (
    <div className="app-grid">
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

          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <span style={{
              fontSize: '0.65rem', padding: '0.2rem 0.4rem', borderRadius: '4px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#10b981', fontWeight: '700'
            }}>
              LOCAL
            </span>
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
                      {doc.suggested_title || doc.filename}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.4rem' }}>
                      {doc.category && (
                        <span style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(124,58,237,0.12)', color: '#a78bfa', fontWeight: '600' }}>
                          {doc.category}
                        </span>
                      )}

                      <span style={{
                        fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: '4px',
                        background: doc.status === 'processed' ? 'rgba(16,185,129,0.1)' : doc.status === 'processing' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                        color: doc.status === 'processed' ? '#34d399' : doc.status === 'processing' ? '#fbbf24' : '#f87171',
                        display: 'flex', alignItems: 'center', gap: '0.2rem'
                      }}>
                        {doc.status === 'processed' ? <CheckCircle size={8} /> : doc.status === 'processing' ? <Clock size={8} /> : <AlertCircle size={8} />}
                        {doc.status}
                      </span>
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
                if (settingsTab === 'models') {
                  fetchModels();
                }
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
                      {selectedDocDetails.suggested_title || selectedDocDetails.filename}
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

                {/* Dynamic Preview Frame */}
                {renderPreviewFrame(selectedDocDetails)}

                {/* AI Summary */}
                {selectedDocDetails.summary && (
                  <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '800', color: '#a78bfa', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Sparkles size={14} />
                      <span>AI Synthesized Summary</span>
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: '1.45' }}>
                      {selectedDocDetails.summary}
                    </p>
                  </div>
                )}

                {/* Document Chunks */}
                {selectedDocDetails.chunks && selectedDocDetails.chunks.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Indexed Text Portions ({selectedDocDetails.chunks.length})
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
                            {res.suggested_title || res.filename}
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
                        {src.suggested_title || src.filename}
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
                onClick={() => {
                  setSettingsTab('models');
                  fetchModels();
                }}
                style={{
                  background: settingsTab === 'models' ? 'rgba(124, 58, 237, 0.12)' : 'none',
                  border: 'none',
                  color: settingsTab === 'models' ? '#a78bfa' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0.5rem 1.25rem',
                  borderRadius: '8px',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  transition: 'var(--transition-fast)'
                }}
              >
                AI Model Manager
              </button>
            </div>

            {/* Content Tab conditional views */}
            <div style={{ flex: '1', overflowY: 'auto', maxHeight: '420px', paddingRight: '0.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {settingsTab === 'general' ? (
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
                        <span style={{ color: 'var(--text-muted)' }}>Active AI LLM Model</span>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{activeModel}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>OCR Engine</span>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>EasyOCR Native (Python)</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Vector Database</span>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>PostgreSQL + pgvector (768d)</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* AI Model Manager Tab */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Manage Local AI Models
                    </h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                      RecallOS runs fully private inference inside Ollama. Choose, download, or remove your model weights below.
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {modelsList.map((model) => {
                      const isActive = activeModel === model.name;
                      const isInstalled = model.installed;
                      const isDownloading = downloadingModel === model.name;

                      return (
                        <div
                          key={model.name}
                          className="glass-panel"
                          style={{
                            padding: '1.25rem',
                            border: isActive ? '2px solid #7c3aed' : '1px solid var(--panel-border)',
                            background: isActive ? 'rgba(124, 58, 237, 0.04)' : 'var(--surface-subtle)',
                            boxShadow: isActive ? '0 0 20px rgba(124, 58, 237, 0.15)' : 'none',
                            borderRadius: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                            position: 'relative',
                            transition: 'all 0.3s ease'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ minWidth: '0', flex: '1', paddingRight: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--text-primary)' }}>
                                  {model.name}
                                </span>
                                {model.is_default && (
                                  <span style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontWeight: '700' }}>
                                    DEFAULT
                                  </span>
                                )}
                              </div>
                              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem', lineHeight: '1.3' }}>
                                {model.description}
                              </p>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem', flexShrink: 0 }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: '700', padding: '0.2rem 0.5rem', borderRadius: '6px', background: 'var(--chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--chip-border)' }}>
                                {model.size}
                              </span>
                              {isInstalled && (
                                <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(16,185,129,0.12)', color: '#34d399', fontWeight: '700' }}>
                                  INSTALLED
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Downloading Progress Bar */}
                          {isDownloading && (
                            <div style={{ marginTop: '0.25rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <div className="animate-spin" style={{ width: '10px', height: '10px', border: '2px solid #a78bfa', borderTopColor: 'transparent', borderRadius: '50%' }} />
                                  Pulling model layers...
                                </span>
                                <span style={{ fontWeight: '700', color: '#a78bfa' }}>{downloadProgress}%</span>
                              </div>
                              <div style={{ width: '100%', height: '8px', background: 'var(--surface-muted)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div
                                  className="progress-bar-shine"
                                  style={{
                                    width: `${downloadProgress}%`,
                                    height: '100%',
                                    background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
                                    transition: 'width 0.2s ease-out',
                                    borderRadius: '4px'
                                  }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Action Controls */}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                            {isInstalled ? (
                              <>
                                {!isActive ? (
                                  <button
                                    onClick={() => handleActivateModel(model.name)}
                                    className="btn-secondary"
                                    disabled={downloadingModel !== null}
                                    style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '8px', cursor: 'pointer' }}
                                  >
                                    Activate
                                  </button>
                                ) : (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#34d399', fontSize: '0.8rem', fontWeight: '700', padding: '0.4rem 0.75rem' }}>
                                    <CheckCircle size={14} />
                                    Active Model
                                  </span>
                                )}

                                {!isActive && (
                                  <button
                                    onClick={() => handleDeleteModel(model.name)}
                                    disabled={downloadingModel !== null}
                                    style={{
                                      background: 'none',
                                      border: '1px solid rgba(239, 68, 68, 0.2)',
                                      color: '#f87171',
                                      cursor: 'pointer',
                                      padding: '0.4rem 0.75rem',
                                      borderRadius: '8px',
                                      fontSize: '0.8rem',
                                      transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => {
                                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                                    }}
                                    onMouseOut={(e) => {
                                      e.currentTarget.style.background = 'none';
                                    }}
                                  >
                                    Delete
                                  </button>
                                )}
                              </>
                            ) : (
                              !isDownloading && (
                                <button
                                  onClick={() => handleDownloadModel(model.name)}
                                  className="btn-primary"
                                  disabled={downloadingModel !== null}
                                  style={{ padding: '0.4rem 1.25rem', fontSize: '0.8rem', borderRadius: '8px', cursor: 'pointer' }}
                                >
                                  Download & Install
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
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
