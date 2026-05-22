# Project Structure

This document maps the current repository and explains ownership boundaries.

## Root

```text
recallos/
├── README.md
├── docker-compose.yml
├── ai-services/
├── backend/
├── client/
└── docs/
```

## `ai-services/`

```text
ai-services/
├── chunker.py
├── ocr_service.py
└── ollama_client.py
```

- `chunker.py`: converts extracted text into overlapping semantic chunks.
- `ocr_service.py`: wraps EasyOCR and returns deterministic fallback text when OCR is unavailable.
- `ollama_client.py`: communicates with Ollama for embeddings, completions, model fallback, and metadata extraction.

Keep AI-specific logic here when it can be reused outside Django. Keep request/response concerns in `backend/core/views.py`.

## `backend/`

```text
backend/
├── manage.py
├── requirements.txt
├── core/
│   ├── models.py
│   ├── serializers.py
│   ├── tasks.py
│   ├── tests.py
│   ├── urls.py
│   └── views.py
└── recallos/
    ├── settings.py
    ├── urls.py
    ├── celery.py
    ├── asgi.py
    └── wsgi.py
```

### `backend/core/models.py`

Defines durable data:

- `Document`
- `DocumentChunk`
- `ChatSession`
- `ChatMessage`

### `backend/core/serializers.py`

Defines API serialization for documents, chunks, sessions, and messages.

### `backend/core/views.py`

Defines API behavior:

- document CRUD
- semantic search
- chat message creation
- Ollama model list/pull/delete

### `backend/core/tasks.py`

Defines Celery document processing. This is the main ingestion pipeline.

### `backend/recallos/settings.py`

Central Django configuration: database, CORS, REST framework, Celery, Ollama, OCR.

## `client/`

```text
client/
├── package.json
├── vite.config.js
├── index.html
├── public/
└── src/
    ├── App.jsx
    ├── index.css
    ├── main.jsx
    └── components/
        └── LazyLoader.jsx
```

### `client/src/App.jsx`

The main application component. It currently owns:

- document state
- search state
- chat state
- settings and model manager state
- API calls
- most UI rendering

Future work should split this file into feature modules once behavior stabilizes:

```text
client/src/features/documents/
client/src/features/search/
client/src/features/chat/
client/src/features/settings/
client/src/lib/api.js
```

### `client/src/index.css`

Global styles and theme variables. Add reusable visual tokens here instead of hardcoding colors inside components.

## `docs/`

Long-term technical documentation. Files should stay topic-specific. Avoid dumping all information into one large document.

## Generated and Runtime Directories

- `client/dist/`: generated frontend build output.
- `client/node_modules/`: local package install output.
- `backend/media/`: uploaded files.
- `__pycache__/`: Python bytecode cache.

These should not be treated as source documentation.
