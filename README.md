# RecallOS Server

RecallOS Server is the Django/Groq backend used by the RecallOS desktop client. It persists chat state, calls Groq for AI generation, and provides stateless fallback document processing.

The server is not the source of truth for the user's document library. In the active architecture, document metadata, chunks, vectors, and search indexes live in the Tauri client.

## Runtime Role

The server currently provides:

- chat session persistence in Postgres;
- chat message persistence in Postgres;
- assistant message source persistence in Postgres;
- final prompt construction from user message plus client-supplied `context_chunks`;
- per-response source-ref assignment and source filtering based on refs cited by the LLM;
- LLM generation through Groq;
- stateless document fallback processing;
- stateless document summary generation;
- stateless embedding generation through local Ollama `bge-m3`.

## Non-Responsibilities

The active implementation does not provide persistent server-side document memory:

- no persistent uploaded file storage;
- no persistent document metadata storage;
- no persistent document chunk storage;
- no server-side vector database for user documents;
- no server-side semantic search route;
- no active `Document` or `DocumentChunk` Django models.

The initial migration creates chat tables only.

## Dependencies

The backend uses:

- Django;
- Django REST Framework;
- PostgreSQL via `psycopg2-binary`;
- `requests` for Groq API calls;
- `PyPDF2` and `PyMuPDF` for PDF extraction/rendering;
- Pillow;

## Docker Runtime

`docker-compose.yml` runs:

- `web`: the Django API on port `8000`;
- `db`: PostgreSQL 16 on port `5432`.

Groq is configured through `.env`:

```text
GROQ_API_KEY=...
```

Model routing is fixed and explicit:

```text
GROQ_TEXT_MODEL=llama-3.1-8b-instant
GROQ_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
```

## Active Endpoints

```text
POST     /api/documents/process/
POST     /api/documents/summary/
POST     /api/embeddings/
GET/POST /api/chat/session/
GET      /api/chat/session/<id>/
POST     /api/chat/session/<id>/message/
GET      /api/models/
```

There are no persistent `/api/documents/` CRUD routes and no `/api/search/semantic/` route in the active API.

## Stateless Document Processing

`POST /api/documents/process/` accepts multipart file upload and returns extracted text plus metadata.

Example response:

```json
{
  "filename": "document.pdf",
  "file_type": "pdf",
  "text": "...",
  "chunks": ["..."],
  "suggested_title": "Document",
  "summary": "...",
  "category": "General",
  "tags": ["AI-Ingested"]
}
```

Supported fallback extraction currently includes:

- text-like files;
- Markdown;
- common code/config formats;
- CSV/HTML/CSS;
- text and metadata from digital PDFs through `PyPDF2`;
- rendered PDF pages through the Groq vision model when possible;
- images/screenshots/scans through the Groq vision model.

Text files, Markdown, code, normal chat, RAG chunks, summaries, metadata, and categories use `llama-3.1-8b-instant`. Images, screenshots, scans, and PDFs use `meta-llama/llama-4-scout-17b-16e-instruct`.

Temporary upload files are deleted after processing.

## Stateless Summary Generation

`POST /api/documents/summary/` accepts already extracted document text:

```json
{
  "filename": "document.txt",
  "text": "..."
}
```

It calls Groq through `generate_document_summary` and returns:

```json
{
  "summary": "..."
}
```

The endpoint persists nothing.

## Stateless Embeddings

`POST /api/embeddings/` accepts a list of text strings:

```json
{
  "texts": ["first chunk", "second chunk"],
  "model": "ignored"
}
```

It returns:

```json
{
  "embeddings": [[0.0]]
}
```

The implementation calls local Ollama with `bge-m3`:

1. First, `/api/embed` for batch embedding.
2. If needed, `/api/embeddings` one text at a time.
3. If Ollama embedding calls fail, it returns zero vectors sized to 1024 dimensions to preserve the indexing contract.

The endpoint persists no vectors or user text.

## Chat Context

The chat message endpoint expects the client to send local retrieval output as `context_chunks`:

```json
{
  "content": "question",
  "context_chunks": [
    {
      "document_id": "local-123",
      "filename": "notes.md",
      "suggested_title": "Project Notes",
      "chunk_index": 0,
      "page_number": 1,
      "section_title": "Overview",
      "content_type": "paragraph",
      "reason": "semantic_rerank",
      "entities": {},
      "content": "..."
    }
  ]
}
```

The server:

1. Saves the user message.
2. Converts up to 24 client context chunks into prompt context.
3. Assigns temporary source refs such as `[S1]`, `[S2]`, and stores a source map for the current response only.
4. Builds a system prompt that asks the LLM to cite only source refs that directly support the answer.
5. Calls Groq text model through `generate_completion`.
6. Extracts cited source refs from the generated answer.
7. Strips source-ref markers from the visible assistant text.
8. Saves the assistant message with a `sources` array filtered to cited refs only.
9. Returns the serialized assistant message.

The server does not search documents itself in this flow. Source refs are rebuilt for every new answer, so sources do not accumulate across chat turns.

Example model-facing context format:

```text
Source Ref: [S1]
Source Document: notes.md (Section: Overview; Page: 1; Chunk: 0; Type: paragraph; Reason: semantic_rerank)
Detected Entities: {}
Content Excerpt:
...
---
```

The LLM may respond internally with text such as:

```text
The document describes local AI memory. [S1]
```

The API response stores the clean visible text:

```text
The document describes local AI memory.
```

and `sources` contains only the source mapped to `S1`.

## Chat Persistence

The active Django models are:

- `ChatSession`
- `ChatMessage`

`ChatMessage.sources` stores source metadata filtered from client-supplied context chunks based on the source refs cited by the model in that specific answer.

## Model Endpoint

- `GET /api/models/`

It returns the configured Groq text and vision model profiles. There is no local model pull/delete flow.

## Current Limitations

- No server-side document database or vector index.
- No server-side semantic search.
- No persistent upload storage.
- PDF rendering requires `PyMuPDF`; if rendering fails, digital text extraction is used as fallback.
- Embeddings require local Ollama with `bge-m3`; failures degrade to zero vectors instead of failing the request.
- Authentication is not enforced; endpoints use `AllowAny`.
- `GROQ_API_KEY` must be set for AI chat, summary, metadata, category, and vision extraction.

## Verification

From `recall-server/backend`:

```bash
DB_NAME=recallos_db DB_USER=recallos_admin DB_PASSWORD=admin_secure_password_replace_me DB_HOST=127.0.0.1 DB_PORT=5432 ../backend/.venv/bin/python manage.py test core
```

To check migrations without writing new files:

```bash
DB_NAME=recallos_db DB_USER=recallos_admin DB_PASSWORD=admin_secure_password_replace_me DB_HOST=127.0.0.1 DB_PORT=5432 ../backend/.venv/bin/python manage.py makemigrations --check --dry-run
```
