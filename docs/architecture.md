# Architecture

RecallOS is a local-first AI application with a browser client, Django API, async processing worker, vector database, Redis broker, and Ollama model runtime.

## High-Level System

```text
Browser
  |
  | HTTP JSON / multipart uploads
  v
React + Vite client
  |
  | /api/*
  v
Django REST Framework API
  |
  | writes metadata, sessions, chunks
  v
PostgreSQL + pgvector
  |
  | background task enqueue
  v
Redis broker -> Celery worker
  |
  | text extraction, OCR, embeddings, metadata
  v
ai-services -> Ollama
```

## Runtime Components

### Client

The client is a React single-page application in `client/`. It handles:

- document upload and library browsing
- semantic search UI
- document preview
- chat interface
- model manager
- theme switching

The client computes the backend host from `window.location.hostname` and calls port `8000`.

### Django API

The backend in `backend/` provides REST endpoints through Django REST Framework. It owns:

- local workspace data access with no users or login layer
- document records and file storage
- search over `DocumentChunk.embedding`
- chat sessions and messages
- Ollama model catalog, pull, and delete endpoints

### Celery Worker

The Celery worker runs `process_document_pipeline(document_id)` after uploads. It performs heavy work outside the request path:

- read uploaded file
- extract text
- OCR image files
- split text into chunks
- generate embeddings
- store vector chunks
- synthesize metadata

### AI Services

The `ai-services/` directory is intentionally separate from Django app code. It contains reusable AI helpers:

- `ollama_client.py`: embedding, completion, fallback model lookup, metadata extraction
- `chunker.py`: chunk construction with overlap
- `ocr_service.py`: EasyOCR integration with safe fallback

### Data Stores

PostgreSQL stores durable data and pgvector embeddings. Redis is used as Celery broker and result backend. Ollama stores models in the Docker volume named `ollama`.

## Request Flows

### Document Upload Flow

```text
User uploads file
  -> POST /api/documents/
  -> Document row created with status=pending
  -> Celery task queued
  -> worker updates status=processing
  -> extracted text is chunked
  -> embeddings are generated through Ollama
  -> DocumentChunk rows are created
  -> metadata is generated through Ollama
  -> Document row updated with status=processed
```

### Semantic Search Flow

```text
User submits natural language query
  -> POST /api/search/semantic/
  -> query embedding generated through Ollama
  -> local workspace chunks annotated with CosineDistance
  -> top results returned with similarity score
```

### Chat Flow

```text
User sends chat message
  -> POST /api/chat/session/{id}/message/
  -> user message stored
  -> query embedding generated
  -> top local workspace chunks retrieved
  -> prompt assembled with retrieved context
  -> Ollama completion generated
  -> assistant message stored with source references
```

## Security Boundaries

- RecallOS is intended for local-only use on a trusted machine or private development network.
- Workspace endpoints do not require authentication and do not model application users.
- Uploaded files are stored under `backend/media/`.
- The current development settings allow all CORS origins. Do not expose the API directly to untrusted networks without adding an access boundary outside the app.

## Key Tradeoffs

- The system favors local-first operation over external AI APIs.
- Celery keeps upload requests responsive but requires Redis and a worker process.
- pgvector keeps search inside PostgreSQL, reducing operational complexity.
- The client is currently simple to iterate on but should be decomposed as it grows.
