# RecallOS Client

RecallOS is a client-first personal knowledge workspace. User documents, extracted text, chunks, embeddings, and semantic index data are stored locally in the desktop client. The server is used for chat/session persistence, Ollama-backed generation, and stateless fallback processing for files that cannot be indexed locally.

## Current Architecture

```text
Local file
  -> Tauri/Rust file reader
  -> client document intelligence pipeline
  -> local BGE-M3 embeddings
  -> local LanceDB
  -> local hybrid retrieval for chat/search
  -> compact context sent to Django chat endpoint
  -> host Ollama generates answer
```

The server does not persist user files or document metadata in the active document flow.

## Client Responsibilities

- Open files through the native Tauri file dialog.
- Read local files through Rust commands.
- Extract local text from supported text/code files and digital PDFs.
- Split documents into structure-aware chunks.
- Extract local metadata such as section titles, page numbers, keywords, and lightweight entities.
- Build BGE-M3 embeddings locally in the WebView.
- Store document metadata and vector chunks in local LanceDB.
- Run local semantic search.
- Build the chat context from local documents before sending a message to the server.

## Server Responsibilities

- Store chat sessions and chat messages.
- Receive client-supplied context chunks with chat messages.
- Build the final LLM prompt.
- Call the host Ollama instance for generation.
- Return assistant messages and source snippets.
- Provide `/api/documents/process/` as a stateless fallback for images, scanned PDFs, or files that fail local parsing.

Persistent server-side document upload, document detail, document delete, document summarize, and server-side semantic search are disabled.

## Local Storage

The Tauri client initializes LanceDB under the app data directory:

```text
<app_data_dir>/recallos_lancedb
```

It uses two tables:

- `documents`: local document library metadata.
- `document_chunks`: extracted text chunks, BGE-M3 vectors, and rich retrieval metadata.

`document_chunks.metadata` stores JSON containing:

- `chunk_index`
- `prev_chunk_index`
- `next_chunk_index`
- `page_number`
- `section_title`
- `section_index`
- `content_type`
- `keywords`
- `entities`
- `filename`
- `created_at`

## Document Ingestion

The ingestion flow lives mainly in:

- `src/App.jsx`
- `src/utils/documentIntelligence.js`
- `src/utils/embeddings.js`
- `src-tauri/src/parser.rs`
- `src-tauri/src/db.rs`

Flow:

1. The user selects a file.
2. Tauri returns the local absolute file path.
3. The client creates a local `processing` document record.
4. Rust tries to extract text locally.
5. The client builds smart chunks with page/section/entity metadata.
6. The client generates BGE-M3 embeddings for every chunk.
7. The client stores chunks and vectors in local LanceDB.
8. The document becomes `processed`.

Supported local parsing currently includes:

- text files
- markdown
- common code/config formats
- CSV/HTML/CSS
- digital PDFs

For PDFs, Rust inserts `[Page N]` markers before page text so the JS chunker can preserve page metadata.

## Stateless Server Fallback

Fallback is used when:

- the file is an image;
- local parsing fails;
- a PDF contains no extractable digital text;
- local indexing cannot produce usable chunks.

The client sends the file bytes to:

```text
POST /api/documents/process/
```

The server extracts text/metadata, returns JSON, and does not persist the uploaded file. The client then builds BGE-M3 embeddings and saves the result locally.

## Local Embeddings

Embeddings are generated in:

```text
src/utils/embeddings.js
```

The client uses:

```text
Xenova/bge-m3
```

via `@huggingface/transformers` with WASM execution. The vector dimension is `1024`, matching `VECTOR_DIMENSION` in `src-tauri/src/db.rs`.

The first run downloads the model files into WebView/browser cache. After that, the app can use the cached model locally.

## Smart Chunking

The smart chunker is implemented in:

```text
src/utils/documentIntelligence.js
```

It adds universal structure for large and complex documents:

- detects page markers;
- detects headings/sections;
- preserves section titles;
- creates previous/next chunk links;
- extracts keywords;
- extracts lightweight entities such as organizations, dates, emails, money values, and technologies;
- marks approximate content type such as paragraph/table;
- builds a local document summary from detected structure.

This makes the index more useful than flat text chunking.

## Chat Retrieval

The chat does not send the whole local library to the server.

When the user asks a question:

1. The client classifies query intent:
   - `lookup`
   - `list_all`
   - `summarize`
   - `compare`
   - `timeline`
2. The client embeds the question with BGE-M3.
3. LanceDB returns a broad vector candidate set.
4. The client reranks candidates using:
   - semantic score;
   - keyword overlap;
   - document title/filename affinity;
   - section title affinity;
   - intent-specific boosts.
5. The client fetches local document detail for top candidate documents.
6. The client expands context with neighboring chunks.
7. For broad questions such as “which companies did I work for?” it expands across relevant sections instead of using only the first semantic hit.
8. The client compresses the selected chunks to a bounded context payload.
9. The server receives only this compact `context_chunks` array.

This gives the LLM enough local document context while keeping files and indexes client-owned.

## Chat Generation

The server chat endpoint receives:

```json
{
  "content": "question",
  "context_chunks": []
}
```

The context chunks include:

- document id
- filename
- suggested title
- chunk index
- page number
- section title
- content type
- retrieval reason
- detected entities
- text content

The Django server inserts this into the system prompt, calls Ollama, stores the chat messages, and returns the assistant response.

## Developer Login

In development mode, the client login is local-only:

```text
admin / admin
```

It stores a mock token in `localStorage`. This is not production authentication.

## Verification Commands

Use the bundled Node runtime if the system Node installation is unavailable:

```bash
/Users/fedorrumiantsev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test src/utils/documentIntelligence.test.js
/Users/fedorrumiantsev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build
/Users/fedorrumiantsev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src/App.jsx src/utils/embeddings.js src/utils/documentIntelligence.js src/utils/documentIntelligence.test.js
cd src-tauri && cargo check
```
