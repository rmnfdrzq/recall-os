# API Endpoints

Base URL in local development:

```text
http://127.0.0.1:8000/api
```

The API is local-only and does not require authentication headers.

## Documents

### List Documents

```http
GET /api/documents/
```

Returns all documents in the local workspace.

### Upload Document

```http
POST /api/documents/
Content-Type: multipart/form-data
```

Form fields:

```text
file=<uploaded file>
```

Supported extensions:

- `.txt`
- `.md`
- `.markdown`
- `.pdf`
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

Response includes a `status` of `pending`. The Celery worker later updates it to `processing`, `processed`, or `failed`.

### Get Document Detail

```http
GET /api/documents/{document_id}/
```

Returns document metadata and indexed chunks.

### Delete Document

```http
DELETE /api/documents/{document_id}/
```

Deletes the document row. The model uses cascade deletion for chunks.

## Semantic Search

```http
POST /api/search/semantic/
```

Request:

```json
{
  "query": "notes about PostgreSQL vector search",
  "category": "",
  "top_k": 5
}
```

Response:

```json
{
  "query": "notes about PostgreSQL vector search",
  "results": [
    {
      "document_id": "uuid",
      "filename": "notes.md",
      "suggested_title": "Vector Search Notes",
      "category": "Engineering",
      "content": "Chunk content...",
      "chunk_index": 0,
      "similarity": 0.91
    }
  ]
}
```

Failure modes:

- `400`: empty query
- `503`: embedding generation failed

## Chat Sessions

### List Sessions

```http
GET /api/chat/session/
```

### Create Session

```http
POST /api/chat/session/
```

Request:

```json
{
  "title": "Research Chat"
}
```

### Get Session Detail

```http
GET /api/chat/session/{session_id}/
```

Returns the session and ordered messages.

### Delete Session

```http
DELETE /api/chat/session/{session_id}/
```

## Chat Messages

```http
POST /api/chat/session/{session_id}/message/
```

Request:

```json
{
  "content": "Summarize my notes about RAG",
  "model": "qwen3.5:4b"
}
```

The selected model can also be provided through:

```http
X-Active-Model: qwen3.5:4b
```

Response:

```json
{
  "id": 1,
  "role": "assistant",
  "content": "Answer text...",
  "sources": [
    {
      "document_id": "uuid",
      "filename": "rag.md",
      "suggested_title": "RAG Notes",
      "chunk_index": 2,
      "snippet": "Relevant excerpt..."
    }
  ],
  "created_at": "2026-05-22T12:00:00Z"
}
```

## Ollama Model Management

### List Models

```http
GET /api/models/
```

Response:

```json
{
  "models": [
    {
      "name": "qwen2.5:1.5b",
      "size": "986 MB",
      "description": "Default lightweight LLM - fast & memory-efficient.",
      "installed": true,
      "is_default": true,
      "ollama_available": true
    }
  ],
  "ollama_available": true
}
```

Supported catalog:

- `qwen2.5:1.5b`
- `qwen3.5:4b`
- `gemma4:e2b`

### Pull Model

```http
GET /api/models/pull/?model=qwen3.5:4b
```

Returns server-sent event lines from Ollama.

### Delete Model

```http
POST /api/models/delete/
```

Request:

```json
{
  "name": "qwen3.5:4b"
}
```

Response:

```json
{
  "success": true
}
```
