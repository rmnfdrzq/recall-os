# RecallOS Server

RecallOS Server is the Django backend used by the RecallOS desktop client. It persists chat state, calls Groq as the primary AI provider, falls back to the Ollama daemon reachable from the server for LLM generation when Groq fails, and provides stateless fallback document processing.

The server is not the source of truth for the user's document library. In the active architecture, document metadata, chunks, vectors, and search indexes live in the Tauri client.

## Runtime Role

The server currently provides:

- chat session persistence in Postgres;
- chat message persistence in Postgres;
- assistant message source persistence in Postgres;
- final prompt construction from user message plus client-supplied `context_chunks`;
- per-response source-ref assignment, source filtering based on refs cited by the LLM, and source fallback from supplied context when the LLM omits refs;
- LLM generation through Groq first, with immediate server-host Ollama fallback;
- stateless document fallback processing;
- stateless document summary generation;
- stateless document category generation;
- stateless embedding generation through server-host Ollama `bge-m3`.

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
- `requests` for Groq and Ollama API calls;
- `PyPDF2` and `PyMuPDF` for PDF extraction/rendering;
- Pillow;

## Docker Runtime

`docker-compose.yml` runs:

- `web`: the Django API on port `8000`;
- `db`: PostgreSQL 16 on port `5432`.

AI providers are configured through `.env`:

```text
GROQ_API_KEY=...
```

Model routing is fixed and explicit:

```text
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBEDDING_MODEL=bge-m3
OLLAMA_LLM_MODEL=gemma4:31b-cloud
```

When running through Docker Compose, `OLLAMA_BASE_URL` is set to
`http://host.docker.internal:11434` so the container can reach the server-host Ollama
daemon.

Groq is the primary provider for text and vision-shaped LLM calls. If a Groq request fails,
the same request is retried immediately through the Ollama daemon reachable from `recall-server` using
`gemma4:31b-cloud`. Embeddings still use the server's configured Ollama route with `bge-m3`.

## Active Endpoints

```text
POST     /api/documents/process/
POST     /api/documents/summary/
POST     /api/documents/category/
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
- rendered PDF pages through the universal Groq model when possible, with server-host Ollama LLM fallback if Groq fails;
- images/screenshots/scans through the universal Groq model, with server-host Ollama LLM fallback if Groq fails.

Text files, Markdown, code, normal chat, RAG chunks, summaries, metadata, categories, images, screenshots, scans, and PDFs use `meta-llama/llama-4-scout-17b-16e-instruct`.
Groq calls fall back to server-host Ollama `gemma4:31b-cloud` on provider errors.

Temporary upload files are deleted after processing.

## Stateless Summary And Category Generation

`POST /api/documents/summary/` accepts already extracted document text:

```json
{
  "filename": "document.txt",
  "text": "...",
  "model_profile": "text"
}
```

It calls `generate_document_summary`, using Groq first and server-host Ollama fallback if needed, and returns:

```json
{
  "summary": "..."
}
```

`POST /api/documents/category/` accepts already extracted chunks plus an optional summary:

```json
{
  "filename": "document.txt",
  "summary": "...",
  "chunks": [{ "content": "..." }],
  "model_profile": "text"
}
```

It calls `generate_document_category`, using the same Groq-first/server-host-Ollama-fallback LLM routing, and returns:

```json
{
  "category": "General"
}
```

Both endpoints persist nothing. `model_profile` is `text` for normal text/code/Markdown documents and `vision` for images and PDFs.

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

The implementation calls the Ollama daemon configured for `recall-server` with `bge-m3`:

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
2. Adds the recent chat history to the model prompt so follow-up questions can resolve pronouns and previous context.
3. Converts up to 10 client context chunks into prompt context, trimming individual excerpts and capping total context around 6500 characters.
4. Assigns temporary source refs such as `[S1]`, `[S2]`, and stores a source map for the current response only.
5. Builds a system prompt that asks the LLM to cite only source refs that directly support the answer.
6. Calls the universal Groq model through `generate_completion`; if Groq fails, `generate_completion` immediately retries through server-host Ollama `gemma4:31b-cloud`.
7. Extracts cited source refs from the generated answer.
8. Strips source-ref markers from the visible assistant text.
9. Saves the assistant message with a `sources` array filtered to cited refs. If the model used context but omitted citation markers, the server falls back to the first unique documents from the supplied context, capped at 4 sources.
10. Returns the serialized assistant message.

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

and `sources` contains the source mapped to `S1`. If the answer omitted `[S1]` while context chunks were supplied, `sources` falls back to the relevant context documents so the client can still show document links.

## Chat Persistence

The active Django models are:

- `ChatSession`
- `ChatMessage`

`ChatMessage.sources` stores source metadata derived from client-supplied context chunks. It prefers source refs cited by the model in that specific answer and falls back to unique context documents when citations are omitted.

## Model Endpoint

- `GET /api/models/`

It returns the configured universal Groq model plus the server-side Ollama LLM fallback model.
There is no API-driven model pull/delete flow.

## Current Limitations

- No server-side document database or vector index.
- No server-side semantic search.
- No persistent upload storage.
- PDF rendering requires `PyMuPDF`; if rendering fails, digital text extraction is used as fallback.
- Embeddings require the server's configured Ollama route with `bge-m3`; failures degrade to zero vectors instead of failing the request.
- LLM requests use Groq first and fall back to server-host Ollama `gemma4:31b-cloud` when Groq is unavailable, rate limited, or returns an error.
- Authentication is not enforced; endpoints use `AllowAny`.
- `GROQ_API_KEY` should be set for primary AI chat, summary, metadata, category, and vision extraction.

## Verification

From `recall-server/backend`:

```bash
DB_NAME=recallos_db DB_USER=recallos_admin DB_PASSWORD=admin_secure_password_replace_me DB_HOST=127.0.0.1 DB_PORT=5432 ../backend/.venv/bin/python manage.py test core
```

To check migrations without writing new files:

```bash
DB_NAME=recallos_db DB_USER=recallos_admin DB_PASSWORD=admin_secure_password_replace_me DB_HOST=127.0.0.1 DB_PORT=5432 ../backend/.venv/bin/python manage.py makemigrations --check --dry-run
```
