# 📂 Monorepo Project Structure

This document details the layout of the RecallOS unified monorepo, explaining file boundaries, subfolders, and architectural responsibilities.

---

## 🗺️ Monorepo Root

```text
recallos/
├── README.md                  # Root documentation and startup guide
├── docs/                      # Architectural and technical documentation
├── recall-app/                # React + Tauri desktop client codebase
└── recall-server/             # Django + AI services server codebase
```

---

## 📱 `recall-app/` (Tauri Desktop App)

The desktop client handles document ingestion, local LanceDB storage, search execution, RAG context expansion, and UI display.

```text
recall-app/
├── package.json               # Node dependencies
├── vite.config.js             # Vite configuration
├── eslint.config.js           # Lint rules
├── index.html                 # Entry HTML template
├── public/                    # Static assets
├── src-tauri/                 # Tauri native Rust bridge
│   ├── Cargo.toml             # Rust dependencies
│   ├── tauri.conf.json        # Tauri configuration & capabilities
│   └── src/
│       ├── main.rs            # Desktop setup & command registry
│       ├── db.rs              # Tauri-LanceDB connector commands
│       └── parser.rs          # Native file layout parser
└── src/                       # React frontend codebase
    ├── main.jsx               # Entrypoint script
    ├── App.jsx                # Core app wrapper & layout
    ├── index.css              # Global styling & CSS theme variables
    ├── components/            # Reusable UI widgets
    │   ├── LazyLoader.jsx     # Deferred rendering framework
    │   ├── DocumentList.jsx   # Library panel
    │   ├── ChatPanel.jsx      # AI session message lists
    │   └── DocPreview.jsx     # Document content preview
    ├── hooks/
    │   └── useDocumentLibrary.js # Coordinates local index & sync tasks
    └── utils/
        ├── documentIntelligence.js # Smart overlapping chunker & entity extractor
        ├── embeddings.js      # Backend batch embeddings wrapper
        ├── embeddingsCache.js # Hash-based IndexedDB cache driver
        ├── chatScope.js       # Mentions and scoping resolver
        └── resizableLayout.js # Panel sizing state persistency
```

### Key Subsystems in `recall-app`
*   **`src-tauri/src/parser.rs`**: Fast, local PDF, text, and source code document parser implemented in native Rust.
*   **`src-tauri/src/db.rs`**: Registers native Rust commands invoked by JavaScript to manage and query local vector records in LanceDB.
*   **`src/utils/documentIntelligence.js`**: Client-side smart chunker. Identifies pages, semantic sections, headings, keywords, and parses entities (organizations, monetary values, dates, etc.) directly in the browser runtime.
*   **`src/utils/embeddingsCache.js`**: Uses browser IndexedDB to cache vector mappings by text hash, dramatically reducing embedding generation delays for unchanged files.

---

## ⚙️ `recall-server/` (Backend Server)

The server provides stateless services (embeddings, summary, visual parser, LLM completions) and persists chat session logs.

```text
recall-server/
├── docker-compose.yml         # Container configuration (Postgres + Django)
├── Dockerfile                 # Django container manifest
├── requirements.txt           # Python backend dependencies
├── entrypoint.sh              # Container bootstrap script
├── .env.example               # Config template
├── .env                       # Active credentials (ignored by git)
├── ai-services/               # Modular AI client drivers
│   ├── chunker.py             # Server fallback chunker
│   ├── ocr_service.py         # Visual parser & EasyOCR fallback
│   ├── ollama_client.py       # Server-side Ollama client
│   └── groq_client.py         # Cloud Groq model client
└── backend/                   # Django REST Framework application
    ├── manage.py              # CLI utility
    ├── recallos/              # Project settings & routing
    │   ├── settings.py        # Django configuration
    │   ├── urls.py            # Global URL router
    │   ├── celery.py          # Celery configurations
    │   ├── asgi.py            # Async WebSockets gateway
    │   └── wsgi.py            # Web gateway
    └── core/                  # Core feature application
        ├── models.py          # Database models (ChatSession, ChatMessage)
        ├── serializers.py     # JSON serialization schemas
        ├── urls.py            # API path registry
        └── views.py           # Endpoint controllers
```

### Key Subsystems in `recall-server`
*   **`ai-services/groq_client.py`**: Interacts with the Groq API. Coordinates high-speed chat generations using visual and text LLMs.
*   **`ai-services/ollama_client.py`**: Interacts with the Ollama daemon reachable from `recall-server` for BGE-M3 embeddings, summaries, categories, and LLM text generation fallback.
*   **`backend/core/views.py`**: API views. Handles chat CRUD, `/api/embeddings/`, `/api/documents/process/` transient upload processing, and AI summaries/categories generation.
*   **`backend/core/models.py`**: Defers RAG file metrics to LanceDB while storing `ChatSession` metadata and the `ChatMessage` collection in PostgreSQL.

---

## 🔀 Ownership Boundaries

To keep the codebase maintainable, observe these boundary guidelines:
1.  **Local Storage Rule**: Never add server-side document tables (`Document`, `DocumentChunk`) in the backend PostgreSQL. User files, metadata, and vectors must stay inside the local Tauri LanceDB database.
2.  **Stateless Server Rule**: The server-side API endpoints (`/api/documents/process/`, `/api/documents/summary/`, `/api/embeddings/`) must remain stateless. Files are parsed, embedded, or summarized on the fly and never stored on the server's disk or database.
3.  **UI Component Isolation**: UI elements inside `recall-app/src/components` must remain decoupled from specific global Tauri command states. Interface layout values should pass via parameters or hooks to keep components testable inside standard web browsers.
