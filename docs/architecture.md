# 🏗️ System Architecture

RecallOS is designed as a **hybrid, local-first AI workspace**. Chunks, embeddings, and vector index databases are stored completely within the client's desktop environment, while persistent chat logs, stateless embedding requests, and primary visual and text LLM inference are handled via the Django backend and Ollama/Groq providers.

---

## 🗺️ High-Level System Topology

```text
       +---------------------------------------------------------+
       |                  Tauri Desktop App                      |
       |                                                         |
       |  +--------------------+        +---------------------+  |
       |  |  React Frontend    |------->|   Tauri / Rust      |  |
       |  |  (HTML5 UI Engine) |<-------|   Desktop Bridge    |  |
       |  +---------+----------+        +----------+----------+  |
       |            |                              |             |
       |            | Writes metadata & vectors    |             |
       |            v                              v             |
       |  +--------------------+        +---------------------+  |
       |  |    IndexedDB       |        |      LanceDB        |  |
       |  | (Embedding Cache)  |        |  (Vector Database)  |  |
       |  +--------------------+        +---------------------+  |
       +------------|------------------------------|-------------+
                    |                              |
      JSON REST APIs|                              | Reads local files
                    v                              v
       +--------------------+               +-------------+
       |   Django Server    |-------------->| Local Files |
       |    (recall-server) |               +-------------+
       +----+----------+----+
            |          |
            |          | HTTP JSON API calls
            v          v
   +------------+  +------------+
   |  Postgres  |  |   Ollama   |
   | (Chat Logs)|  | (BGE-M3 &  |
   +------------+  |  Gemma 4)  |
                   +------------+
                        |
                        | HTTP API call
                        v
                   +------------+
                   |  Groq API  |
                   | (Llama 4)  |
                   +------------+
```

---

## 📦 Core Runtime Components

### 1. Tauri Desktop Client (`recall-app`)
The frontend runs as a compiled desktop application utilizing Tauri and React. Its main responsibilities include:
*   **File Selection & Parsing**: Spawns native OS file dialogs to locate local documents. Reads and parses text/Markdown/PDFs using native Rust extractors.
*   **Vector Storage (LanceDB)**: Initializes and queries a local, serverless LanceDB instance on the host machine.
*   **Vector Search & Reranking**: Executes vector searches directly against the local LanceDB. Once results are fetched, it runs a custom JavaScript-based keyword and proximity reranker to yield the final RAG context chunks.
*   **IndexedDB Cache**: Stores computed text hashes and their corresponding vector embeddings locally inside the WebView's IndexedDB, minimizing repeated API calls to the server for static texts.

### 2. Django Backend Server (`recall-server`)
The backend provides a stateless JSON API on port `8000`. Its responsibilities are focused on:
*   **Chat Persistence**: Stores chat session configurations and individual message contents inside PostgreSQL.
*   **Stateless Processing Fallbacks**: Receives transient file uploads (images, scanned PDFs) that Rust cannot parse natively. It processes them using visual LLM routes and returns the plain text + layout markers.
*   **Stateless Inference Routing**: Routes document summary generation, document categorization, and embeddings generation to local Ollama.
*   **Smart Prompt RAG Inference**: Receives selected context chunks and a user question, compiles a system prompt with citation-assigning references (e.g., `[S1]`, `[S2]`), and calls **Groq** for high-speed generation. If Groq is offline or unavailable, it retries the generation instantly via **local Ollama**.
*   **Citation Processing**: Analyzes the generated response, extracts and verifies cited reference markers, maps them back to the source documents, strips them from the client-facing text, and commits the citation mapping to the message model.

### 3. Model Engine (Ollama & Groq)
*   **Ollama**: Acts as the local AI provider. It generates text embeddings via `bge-m3` and provides fallback generation using `gemma4:31b-cloud`.
*   **Groq API**: Acts as the high-performance primary text and vision LLM engine using the `meta-llama/llama-4-scout-17b-16e-instruct` model.

---

## 🔄 Core Request Flows

### 1. Document Ingestion Flow (Local-First)
```text
User selects local file
  -> React hook initialized
  -> Rust parser reads file bytes locally
  -> [Success] Rust extracts plain text
  -> [Failure] Client uploads bytes to POST /api/documents/process/ (transient parser fallback)
  -> Client slices plain text into smart, overlapping chunks
  -> Client requests AI summary from POST /api/documents/summary/
  -> Client requests AI category from POST /api/documents/category/
  -> Client queries local IndexedDB for existing chunk hashes
  -> Client requests missing embeddings from POST /api/embeddings/ (using BGE-M3 via Ollama)
  -> Client commits metadata to LanceDB 'documents' table
  -> Client commits vectors & chunks to LanceDB 'document_chunks' table
  -> Document status marked 'processed' in UI
```

### 2. Semantic Search Flow (Local-First)
```text
User types search query
  -> Client requests embedding for query from POST /api/embeddings/
  -> Client calls 'search_local_vectors' Tauri Rust command
  -> Rust queries LanceDB index for nearest neighbors (L2 distance)
  -> Rust returns nearest chunks with similarity scores
  -> Client renders results in UI panel
```

### 3. AI RAG Chat Flow (Hybrid Client-Server)
```text
User inputs message inside active Chat Session
  -> Client computes document scoping (explicit '@' tags or filename matching)
  -> Client requests query embedding from POST /api/embeddings/
  -> Client runs vector search locally against LanceDB (filtered to active scope if set)
  -> Client applies keyword overlap, section proximity, and intent-based reranking
  -> Client compiles top context chunks and POSTs them to POST /api/chat/session/{id}/message/
  -> Server saves user message in PostgreSQL
  -> Server builds prompt, maps sources to [S1], [S2] tags, and requests completion from Groq
  -> [Groq Fail] Server catches error, retries completion instantly via local Ollama
  -> Server parses cited tags in response, resolves source documents, and strips tags from final text
  -> Server saves assistant message + sources mapping
  -> Server returns serialized assistant message to client
```

---

## 🔒 Security & Privacy Posture

*   **Local Data Seeding**: Document files never reside on a remote server. The local LanceDB instance lives under user app data directories.
*   **Transient Server-Side Parsing**: When files are sent to the `/api/documents/process/` fallback parsing API, they are processed entirely in memory or temporary files, and are deleted immediately upon returning the response.
*   **Zero Authentication in Dev Mode**: The Django settings use `AllowAny` permissions by default. In development, authentication is simulated inside the client's `localStorage` (`admin / admin`). The API should not be exposed to untrusted networks without adding authentication middlewares or proxy boundaries.
