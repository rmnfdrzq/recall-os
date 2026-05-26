# 💡 Core Product Use Cases & Features

RecallOS is built to function as a professional, reactive desktop research hub. It facilitates five primary interaction patterns.

---

## 📥 1. Local Document Import & Ingestion

Users can build a local document database without exposing their raw files to permanent cloud storage.

### Flow & UI Progression
1.  **Selection**: The user clicks the "Import File" button or drops a file into the Library Sidebar.
2.  **OS-Native Dialog**: Tauri opens a native system file picker, exposing supported extensions (`.pdf`, `.md`, `.txt`, and code formats).
3.  **Local Index Registry**: The client inserts a document record into local LanceDB with a status of `processing`.
4.  **Parsing Phase**:
    *   **Native Parsing**: Rust commands inside `src-tauri/src/parser.rs` attempt to read and parse the text directly on the host machine.
    *   **Fallback OCR Routing**: If native parsing fails (e.g. image files or complex scanned PDFs), the file bytes are sent to `POST /api/documents/process/`. The server processes the visual layout and returns the text, then cleans up its temporary folders.
5.  **Metadata Enrichment**: The client triggers the stateless API `POST /api/documents/summary/` and `POST /api/documents/category/` to generate a suggested title, structured summary, and document category tag.
6.  **Vector Registration**: Text chunks are sliced, embedded via BGE-M3, and written to LanceDB alongside metadata.
7.  **Final State**: The document status advances to `processed` in the UI list, exposing the suggested title and category tag.

---

## 🔍 2. Local Semantic & Contextual Search

Users can query their entire document library using natural language, returning conceptually relevant text passages instead of exact keyword hits.

### Flow & UI Progression
1.  **Search Bar Input**: The user enters a concept (e.g., "how is vector search dimension padded?") inside the central workspace query bar.
2.  **API Embedding**: The query string is vectorized to a 1024-dimensional float array.
3.  **Local LanceDB Query**: Tauri runs `search_local_vectors` using L2 Euclidean distance.
4.  **UI Layout**: Search results are displayed directly in the **central preview panel** (instead of overlapping on top of the active document preview), listing:
    *   Matching chunk text snippets.
    *   Parent document suggested titles.
    *   Approximate similarity confidence percentages.
    *   Specific page numbers and section coordinates.
5.  **Direct Navigation**: Clicking a search result item opens the parent document in the preview pane, automatically focusing the file.

---

## 💬 3. Scoped AI Chat & Contextual RAG

Users can converse with their library in natural language. Conversational queries can be scoped to the entire database, specific files, or automatic keyword intersections.

```text
    +--------------------------------------------------------------+
    |                         Chat Input                           |
    +--------------------------------------------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
   Explicit Scope                                      Implicit Scope
   (Type '@' to trigger suggest list)                  (Type document title in sentence)
         |                                                   |
         +-------------------------+-------------------------+
                                   |
                                   v
                      RAG Context Filter & Rerank
```

### 1. Explicit Scoping via `@` Mentions
*   **Trigger**: Typing `@` in the chat input opens a dropdown list of all indexed documents, filtered by file title.
*   **Tokenization**: Selecting a file wraps it in a scoped chip (e.g., `@recallos_spec.pdf`) and appends it to the active prompt context.
*   **Execution**: Retrieval querying is strictly locked to the LanceDB rows matching the scoped document UUIDs.

### 2. Implicit Scoping
*   **NLP Scan**: If no explicit `@` mentions exist, the client-side chat processor scans the question string for keywords that match known document filenames or suggested titles.
*   **Resolution**: If a high-affinity match is resolved, the system prompts the user and automatically narrows the RAG search scope to those identified files.

### 3. Open Library Chat
*   If no scope is specified, semantic search spans the entire database. Chunks are retrieved from all documents, and the Javascript reranker weights candidates based on document diversity and keyword alignment to compile the final prompt payload.

### 4. Interactive Citations & Sources
*   The assistant's response displays **interactive source chips** (e.g. `RecallOS Spec`) indicating supporting documents.
*   Clicking a source chip opens the parent document directly in the central preview column, letting the user verify the AI's claims.

---

## 📐 4. Persistent Resizable Layout

RecallOS features a workspace interface split into three adjustable columns to match your monitoring and reading preferences:

```text
+-------------------+----------------------------+-----------------------+
|  Library Sidebar  |   Central Preview & Search |       AI Chat Panel   |
|   (Browse files)  |   (Read PDF, check search) |   (Ask scoped Qs)     |
+-------------------+----------------------------+-----------------------+
|<----------------->|<-------------------------->|<--------------------->|
      Column 1                 Column 2                  Column 3
```

*   **Adjustment**: Grab and slide the vertical bars between Column 1/2 or Column 2/3 to resize the panes.
*   **Persistency**: Panel width allocations are saved as fractional shares inside the browser's `localStorage` under `recallos.layout.columns`.
*   **Responsiveness**: Layout values dynamically recalculate on window resize events, falling back gracefully to standard defaults if cached states are corrupted or invalid.

---

## 🔐 5. Developer Mock Authentication

For local development simplicity and clean workflow verification, the application uses a simulated authorization layer:
*   **Credentials**: Admin panel exposes a mock log in via `admin / admin`.
*   **Storage**: Once logged in, the client registers a mock token in `localStorage`, letting developers bypass security prompts and test API layouts directly.
*   **Stateless Policy**: In development mode, the backend relies on Django's `AllowAny` permissions, speeding up REST routing testing while remaining separated from client state.
