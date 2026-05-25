# RecallOS Client

RecallOS Client is a Tauri + React desktop app for local document indexing, semantic search, and chat over a personal document library.

The current implementation is a client-first RAG workspace: document metadata, extracted chunks, vectors, and search index data are stored in the desktop app's local LanceDB database. The Django server is still required for chat persistence, Ollama-backed LLM responses, document summary generation, server-side fallback parsing, and BGE-M3 embeddings.

## Current Architecture

```text
Local file
  -> Tauri/Rust file picker and file reader
  -> local parser for text/code/PDF files
  -> Django fallback parser for images, scanned/failed PDFs, and unsupported local parse cases
  -> client smart chunking and metadata normalization
  -> server /api/embeddings/ backed by host Ollama BGE-M3
  -> local LanceDB document_chunks table
  -> local vector search
  -> client context expansion and reranking
  -> compact context_chunks sent to Django chat endpoint
  -> host Ollama generates answer
```

The active client does not upload files for persistent server storage. Fallback file processing is transient.

## Runtime Requirements

- Tauri desktop runtime.
- Django backend reachable at `http://127.0.0.1:8000` in desktop/dev mode.
- Host Ollama reachable by the backend through `OLLAMA_BASE_URL`.
- An Ollama embedding model compatible with `bge-m3`.
- An Ollama LLM model configured by the backend, currently defaulting to `gemma4:e2b`.

Browser-only mode is limited. Client-first indexing and semantic search require the desktop app and local LanceDB.

## Client Responsibilities

- Open local files through the native Tauri file dialog.
- Read local file bytes when server fallback processing is needed.
- Parse supported local files through Rust commands.
- Build structure-aware chunks in the client.
- Add metadata such as section titles, page numbers, keywords, lightweight entities, previous/next chunk links, and content type.
- Request BGE-M3 embeddings from the backend `/api/embeddings/` endpoint.
- Cache embeddings in browser IndexedDB by text hash.
- Store document records and vector chunks in local LanceDB.
- Run local vector search through Tauri commands.
- Build compact chat context from local search results before sending a chat message to the server.
- Display document library, document preview, AI summaries, semantic search results, chat sessions, and source chips.
- Let users scope chat questions to specific documents with `@` mentions, or by explicitly typing a document filename/title in the question.
- Let users resize the library, preview/search, and AI chat columns. Column widths are persisted in `localStorage`.

## Server Responsibilities Used by the Client

- `POST /api/documents/process/` for transient fallback file processing.
- `POST /api/documents/summary/` for transient AI summary generation from already extracted text.
- `POST /api/embeddings/` for stateless BGE-M3 embedding generation through Ollama.
- `GET/POST /api/chat/session/` for chat sessions.
- `GET /api/chat/session/<id>/` for session detail and message history.
- `POST /api/chat/session/<id>/message/` for final prompt construction, Ollama generation, and assistant message persistence.

## Local Storage

The Tauri client initializes LanceDB under the app data directory:

```text
<app_data_dir>/recallos_lancedb
```

It uses two tables:

- `documents`: local document library metadata.
- `document_chunks`: extracted chunk text, vectors, and retrieval metadata.

`documents` stores:

- `id`
- `filename`
- `file_type`
- `status`
- `summary`
- `suggested_title`
- `category`
- `tags`
- `file_path`
- `created_at`
- `updated_at`

`document_chunks.metadata` stores JSON containing values such as:

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

- `src/hooks/useDocumentLibrary.js`
- `src/utils/documentIntelligence.js`
- `src/utils/embeddings.js`
- `src/utils/embeddingsCache.js`
- `src/utils/chatScope.js`
- `src/utils/resizableLayout.js`
- `src-tauri/src/parser.rs`
- `src-tauri/src/db.rs`

Flow:

1. The user selects or drops a file.
2. In desktop mode, Tauri returns a local absolute file path.
3. The client creates a local `processing` document record.
4. Rust tries to parse supported local file types.
5. If local parsing fails, or if the file is an image, the client sends file bytes to the stateless server fallback endpoint.
6. The client builds or normalizes smart chunks.
7. The client requests AI summary generation from `/api/documents/summary/`.
8. The client requests BGE-M3 embeddings from `/api/embeddings/`, using IndexedDB cache hits where available.
9. The client stores chunks and vectors in local LanceDB.
10. The document becomes `processed`.

Current document statuses include:

- `processing`
- `summarizing`
- `indexed_text`
- `indexing_vectors`
- `processed`
- `failed`

## Supported File Types

Local Rust parsing currently supports:

- `.txt`
- `.md`
- `.py`
- `.js`
- `.ts`
- `.jsx`
- `.tsx`
- `.json`
- `.csv`
- `.html`
- `.css`
- `.rs`
- `.go`
- `.yaml`
- `.yml`
- `.ini`
- `.conf`
- digital `.pdf`

The native file picker currently exposes:

- `txt`
- `md`
- `pdf`
- `py`
- `js`
- `ts`
- `json`
- `rs`
- `go`
- `csv`
- `html`
- `css`
- `png`
- `jpg`
- `jpeg`
- `webp`

Server fallback supports text-like files, digital PDFs, and images. Image OCR depends on the backend OCR dependency being installed and working. If OCR is unavailable, the server returns a descriptive fallback string rather than real extracted image text.

DOCX, XLSX, PPTX, RTF, web page capture, email import, and folder ingestion are not implemented in the active client.

## Embeddings

Embeddings are currently generated by the Django server endpoint:

```text
POST /api/embeddings/
```

The backend calls host Ollama, preferring `/api/embed` and falling back to `/api/embeddings` when needed. The client names this helper `generateServerEmbeddingsBatch`.

Vectors are expected to be 1024-dimensional for BGE-M3. The local LanceDB layer pads or truncates vectors to `VECTOR_DIMENSION = 1024`.

The current client does not run `@huggingface/transformers` in the WebView.

## Smart Chunking

The smart chunker is implemented in:

```text
src/utils/documentIntelligence.js
```

It currently:

- detects `[Page N]` markers;
- detects likely headings and section titles;
- tracks section indices;
- creates previous/next chunk links;
- extracts simple keywords;
- extracts lightweight entities such as organizations, dates, emails, money values, and common technologies;
- labels approximate content type as `paragraph` or `table`;
- builds expanded context around semantic hits for chat.

This is stronger than flat text chunking, but it is still heuristic. It is not a full document layout parser.

## Search And Chat Retrieval

The search bar:

1. Embeds the query through `/api/embeddings/`.
2. Calls local LanceDB vector search through `search_local_vectors`.
3. Displays top matching chunks with document metadata and approximate match percent.
4. Shows results in the central preview/search area instead of overlaying them on top of the document preview.

The chat flow:

1. Classifies query intent as `lookup`, `list_all`, `summarize`, `compare`, or `timeline`.
2. Determines document scope:
   - if the user selected documents with `@`, search is restricted to those documents;
   - if the user explicitly typed a known filename or suggested title, search is restricted to matching documents;
   - otherwise search uses the full local library.
3. Embeds the user query through `/api/embeddings/`.
4. Runs local vector search against LanceDB.
5. Filters vector results to the active document scope when a scope exists.
6. Reranks candidates in JavaScript using semantic distance, keyword overlap, document title affinity, section title affinity, and intent-specific boosts.
7. Expands context with neighboring chunks.
8. For broad intents, expands across relevant sections.
9. Compresses selected chunks to a bounded `context_chunks` payload.
10. Sends only the selected context chunks to the Django chat endpoint.

The current implementation is vector-first with JavaScript reranking. It does not maintain a separate BM25/full-text index.

## Sources

The backend assigns each context chunk a temporary source ref such as `[S1]`, asks the LLM to cite only refs that directly support the answer, strips those markers from the visible response, and stores only cited sources in the assistant message `sources` array. This keeps source chips tied to documents actually used for the answer rather than every retrieved chunk.

The UI shows source chips under assistant messages. Clicking a source opens the matching document preview when the document exists locally.

Sources currently include document name, suggested title, source ref, chunk index, page number, section title, and a short snippet. The UI does not yet jump to or highlight the exact chunk inside the document preview.

## Chat Input And Markdown

AI chat supports document mentions through `@`. Typing `@` opens a processed-document suggestion list; typing after `@` filters suggestions by filename and suggested title. Selected documents appear as scope chips for the next question.

Assistant answers are rendered through the local markdown renderer. Supported formatting includes bold text with `**bold**`, headings, lists, blockquotes, inline code, code blocks, and links.

## Resizable Layout

The app uses a resizable three-column layout:

- library;
- preview/search;
- AI chat.

Dragging the divider between library and preview changes those two columns. Dragging the divider between preview and AI chat changes those two columns. Widths are stored as relative column shares and persisted in `localStorage` under:

```text
recallos.layout.columns
```

Invalid stored layout values are ignored and the default layout is used. The default layout starts the library column at about `234px` on a 1440px viewport.

## Current Limitations

- Embeddings are server/Ollama-backed, not WebView-local.
- Browser-only mode cannot index documents locally.
- OCR is best-effort and may return fallback text if EasyOCR is unavailable.
- There is no DOCX/XLSX/PPTX parser.
- There is no folder import or web capture.
- There is no user-editable tag manager.
- Chat scoping is document-based only. There is no tag/folder scope selector.
- There is no separate lexical/BM25 search index.
- There is no full reindex button; summary regeneration exists.
- Source chips do not yet deep-link to exact chunks in preview.

## Developer Login

In development mode, the client login is local-only:

```text
admin / admin
```

It stores a mock token in `localStorage`. This is not production authentication.

## Verification Commands

From `recall-app`:

```bash
npm run build
npm run lint
```

Targeted utility tests can be run with Node:

```bash
node --test src/utils/documentIntelligence.test.js
node --test src/utils/chatScope.test.js
node --test src/utils/resizableLayout.test.js
```

For the Tauri Rust layer:

```bash
cd src-tauri
cargo check
```
