# 🤖 Local-First AI & RAG Pipeline Specification

RecallOS executes a specialized, local-first RAG (Retrieval-Augmented Generation) pipeline. Dense vector indexes and text chunks are parsed, managed, and searched directly on the client machine inside Tauri, while heavy visual extractions, batch embeddings, and LLM text generation are delegated to backend APIs.

---

## 📥 Ingestion & Chunking Pipeline

When a document is selected by the user inside `recall-app`, the ingestion workflow is executed:

```text
Local Document -> Native Rust Parser -> Text Chunks & Metadata -> AI Summary -> BGE-M3 Embeddings -> LanceDB Store
```

### 1. Document Extraction
*   **Native Path**: Tauri's Rust parser (`src-tauri/src/parser.rs`) opens supported local file formats (`.pdf`, `.md`, `.txt`, and code files) and extracts text.
*   **Visual Fallback Path**: If native extraction fails or the file is an image, the client uploads it to the `/api/documents/process/` endpoint. The backend uses the primary visual LLM (`llama-4-scout`) to perform layout OCR and returns extracted text.

### 2. Smart Chunking Heuristics
The text extraction is chunked locally inside `src/utils/documentIntelligence.js`:
*   **Slicing Bound**: Chunks are constructed around paragraph and section breaks rather than arbitrary character bounds, using a sliding window with an overlap of roughly 200 characters.
*   **Page Coordinate Tracking**: It detects embedded `[Page N]` tags to resolve exact page numbers.
*   **Section Boundary Analysis**: It identifies likely section titles and headers (e.g. lines starting with `#` or standard numbering blocks) and indexes the current `section_title` and `section_index`.
*   **Coordinate Relations**: Chunks form a linked sequence by storing `prev_chunk_index` and `next_chunk_index` coordinates, enabling adjacent text context expansion during chat generation.
*   **NLP Extraction**: In the WebView, a lightweight JavaScript entity extraction routine identifies monetary values, organizations, dates, and technology names, storing them inside a `metadata.entities` JSON field.

---

## 🧬 Embeddings & Caching Layer

Once text chunks are created, their vector representations are calculated:

```text
Text Chunk -> Normalized Text -> SHA256 Hash -> IndexedDB Lookup
                                                     |
             +-----------------[Hash Hit]------------+------------[Hash Miss]----------------+
             v                                                                              v
    Return Cached Vector                                                         POST /api/embeddings/
                                                                                            |
                                                                                            v
                                                                                   Ollama BGE-M3 (1024d)
                                                                                            |
                                                                                            v
                                                                                  Cache & Return Vector
```

### 1. Vector Spec
*   RecallOS uses the **BGE-M3** multi-lingual embedding model, yielding highly dense **1024-dimensional** floating-point vectors.
*   The LanceDB storage layer pads or truncates incoming vectors to align with `VECTOR_DIMENSION = 1024`.

### 2. Double-Caching Architecture
*   **IndexedDB Cache**: In the client WebView, a Normalized Text Hash Cache (`src/utils/embeddingsCache.js`) checks if a chunk's SHA-256 hash exists in IndexedDB. If found, the vector is returned instantly without hitting the network.
*   **Batching API**: If a cache miss occurs, the client groups missing chunks and issues a single batch HTTP request to `POST /api/embeddings/`.
*   **Ollama Fallback**: The Django server routes embedding requests to the local Ollama API. If the call fails, it yields zero vectors (`[0.0, ...]`) to ensure the document indexing finishes gracefully instead of failing the workspace ingestion.

---

## 🔍 Retrieval & Reranking Pipeline

Semantic search and context matching run entirely locally inside the Tauri React client:

### 1. Local LanceDB Index Querying
*   The search query is embedded via `POST /api/embeddings/` to yield its query vector.
*   Tauri invokes the LanceDB index query (`search_local_vectors` command) using an **L2 Euclidean Distance** metric to select the top nearest neighbor text chunks (usually capping at 10-15 candidates).

### 2. Client-Side Reranking Engine
To optimize context relevancy, the client applies a custom scoring formula to the vector candidates inside `src/utils/chatScope.js`:
```text
Final Score = (Vector Similarity * 0.6) 
            + (Keyword Overlap Boost * 0.2) 
            + (Document Scoping Boost * 0.1) 
            + (Section Context Affinity * 0.1)
```
*   **Intent Boosting**: It determines query intent (e.g. `summarize`, `compare`, `list_all`). If the query demands a comparison, it boosts chunks belonging to multiple distinct document scopes.
*   **Adjacent Context Expansion**: If a chunk score exceeds a relevancy threshold, the RAG engine automatically includes its `prev_chunk_index` and `next_chunk_index` neighbors to restore conversational context and avoid truncated sentences.
*   **Context Compacting**: Expanded chunks are formatted, ordered chronologically, and capped at a maximum of **6500 characters** before sending the payload to the server.

---

## 💬 Chat Prompt Assembly & Citations

```text
Client Chunks -> Server Prompt -> Assign [S1], [S2] -> LLM completion -> Parse Citations -> Save Sources -> Render
```

When context chunks arrive at `/api/chat/session/<id>/message/`, the server executes prompt assembly and strict citation tracking:

### 1. Reference Mapping
The server converts context chunks into a structured system prompt, assigning each chunk a temporary citation reference key (`[S1]`, `[S2]`, etc.):
```text
Source Ref: [S1]
Source Document: recallos_spec.pdf (Section: Architecture; Page: 2; Chunk: 0)
Content Excerpt:
RecallOS utilizes a local LanceDB instance stored inside the user's app data folder...
---
```

### 2. Generation & Retry
*   The prompt instructs the LLM to write a comprehensive answer and cite direct claims *only* using these tags.
*   The server executes the request via **Groq** (`llama-4-scout`). If the API is rate-limited or errors, it retries the generation instantly through **local Ollama** (`gemma4:31b-cloud`).

### 3. Post-Processing & Citation Stripping
*   The server parses the generated text, searching for `\[S\d+\]` patterns.
*   It resolves which sources were actually cited, saving only the cited documents in the database `ChatMessage.sources` payload.
*   All `[S1]`, `[S2]` markers are stripped out of the text before returning the clean string to the client, keeping the UI typography clean and fluid.
*   **No-Citation Fallback**: If the LLM generates a response but neglects to output citation tags, the server falls back to mapping the first unique documents present in the context chunks (capping at 4 items) to ensure the client panel still exposes source chips.
