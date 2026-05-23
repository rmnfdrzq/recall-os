# RecallOS Server

RecallOS Server is the Django/Ollama backend for the client-first desktop app. It persists chat state, calls the host Ollama instance, and provides a stateless document processing fallback. It is not the source of truth for user documents.

## Responsibilities

- Store chat sessions in Postgres.
- Store chat messages and source snippets in Postgres.
- Build the final LLM prompt from the user message and client-supplied local context.
- Call Ollama through the configured `OLLAMA_BASE_URL`.
- Process uploaded fallback files transiently through `/api/documents/process/`.

## Non-Responsibilities

The active architecture contains no server-side document memory:

- no persistent user file storage;
- no persistent document metadata storage;
- no persistent document chunks;
- no server-side vector index for user documents;
- no server-side semantic search.

There are no `Document` or `DocumentChunk` Django models in the active schema. The initial migration creates only chat tables.

## Active Endpoints

```text
GET/POST /api/chat/session/
GET      /api/chat/session/<id>/
POST     /api/chat/session/<id>/message/
POST     /api/documents/process/
GET      /api/models/
POST     /api/models/pull/
DELETE   /api/models/delete/
```

The client UI no longer exposes model download controls, because local client models are limited to BGE-M3 embeddings. The model endpoints are legacy/admin API surface.

There are no persistent `/api/documents/` routes and no `/api/search/semantic/` route.

## Stateless Document Fallback

`POST /api/documents/process/` accepts multipart file upload and returns:

```json
{
  "filename": "document.pdf",
  "file_type": "pdf",
  "text": "...",
  "chunks": [],
  "suggested_title": "...",
  "summary": "...",
  "category": "General",
  "tags": []
}
```

The server uses temporary files for PDF/image extraction where needed and deletes them after processing. The client receives the result, computes BGE-M3 embeddings locally, and stores the document in local LanceDB.

## Chat Context

The chat endpoint expects the client to send local retrieval output as `context_chunks`. Each chunk can include:

- `document_id`
- `filename`
- `suggested_title`
- `chunk_index`
- `page_number`
- `section_title`
- `content_type`
- `reason`
- `entities`
- `content`

The server prompt preserves this structure so the LLM can answer with source-aware context.

## Local Ollama

Docker runs the Django server locally, but Ollama is expected to already be installed on the host machine. The container should point to the host Ollama URL through `OLLAMA_BASE_URL`.

## Verification

From `recall-server/backend`:

```bash
DB_NAME=recallos_db DB_USER=recallos_admin DB_PASSWORD=admin_secure_password_replace_me DB_HOST=127.0.0.1 DB_PORT=5432 ../backend/.venv/bin/python manage.py test core
```
