# 🧠 RecallOS — Local-First AI Document Library & Semantic Chat Workspace

RecallOS is a modern, high-performance, local-first AI application designed to index, preview, search, and chat over your personal document library. It features a client-first RAG (Retrieval-Augmented Generation) workspace leveraging a React + Tauri desktop runtime, a lightweight Django backend, and local vector storage via LanceDB.

```
+-----------------------------------------------------------------------------------+
|                                 RecallOS Workspace                                |
|                                                                                   |
|  +--------------------+      +-------------------------+      +----------------+  |
|  |    recall-app      |      |   Local Vector Storage  |      | recall-server  |  |
|  |   (Tauri/React)    |<---->|  (LanceDB / IndexedDB)  |<---->| (Django API)   |  |
|  +---------+----------+      +-------------------------+      +--------+-------+  |
|            |                                                           |          |
+------------|-----------------------------------------------------------|----------+
             v                                                           v
   +--------------------+                                      +--------------------+
   |    Local Models    |                                      |   Cloud Services   |
   | (Ollama / BGE-M3)  |                                      | (Groq Llama 4 API) |
   +--------------------+                                      +--------------------+
```

---

## ⚡ Key Highlights & Architecture

RecallOS utilizes a **Client-First RAG** architecture, minimizing server load and ensuring privacy by keeping your files and vector databases completely local:

*   **Tauri + Rust File Parsing**: Local parsing for code files, text, Markdown, and digital PDFs directly inside the desktop app using fast, native Rust extractors.
*   **Local LanceDB Vector Database**: Chunks, embeddings, and metadata reside inside the desktop app's directory (`<app_data_dir>/recallos_lancedb`). Vector similarity search runs locally on your machine.
*   **Server Fallback Ingestion**: Transient fallback parsing for images, scanned PDFs, and visual formats using a Django REST API, which routes files through visual LLM extraction (Groq / local Ollama).
*   **Groq-First LLM Chat with Local Fallback**: RAG context is queried locally, compressed by the client, and sent to the Django server. The server constructs the final prompt and queries the primary model via Groq, automatically falling back to a local Ollama model if the provider is offline.

---

## 🛠️ Technology Stack

RecallOS is decomposed into two decoupled services under a unified monorepo:

### 📱 recall-app (Tauri Desktop Client)
*   **Frameworks**: React 18, Vite, Tauri v2 (Rust desktop integration)
*   **Local DB**: LanceDB (Serverless local vector database)
*   **Styles**: Vanilla CSS with modern dark mode tokens, dynamic layouts, and resizable 3-column panels
*   **State & Utilities**: Custom React hooks (`useDocumentLibrary`), `IndexedDB` caching for BGE-M3 vectors, custom client-side semantic reranker

### ⚙️ recall-server (Django Backend)
*   **Frameworks**: Django 5.x, Django REST Framework
*   **Database**: PostgreSQL (Persists chat session state and message history)
*   **AI Providers**: Groq API (Primary provider using `llama-4-scout`), Ollama API (Local embeddings with `bge-m3` and LLM fallback using `gemma4:31b-cloud`)
*   **Extraction Libraries**: `PyPDF2`, `PyMuPDF` (for fallback document layout extraction)

---

## 🚀 Quick Start Guide

### 1. Prerequisites
Ensure you have the following installed on your host system:
*   [Node.js (v18+)](https://nodejs.org/) & `npm`
*   [Rust & Cargo](https://www.rust-lang.org/) (for Tauri compiler)
*   [Docker & Docker Compose](https://www.docker.com/) (for backend services)
*   [Ollama](https://ollama.com/) (running locally)

### 2. Prepare Local Models
Start Ollama and run the following commands to pull the necessary models:
```bash
# Pull the BGE-M3 embedding model
ollama pull bge-m3

# Pull the fallback LLM model
ollama pull gemma4:31b-cloud
```

### 3. Start the Backend Server (recall-server)
1. Navigate to the server folder and copy the environment template:
   ```bash
   cd recall-server
   cp .env.example .env
   ```
2. Open `.env` and fill in your **Groq API Key**:
   ```ini
   GROQ_API_KEY=your_groq_api_key_here
   ```
3. Start the Postgres database and Django web container via Docker:
   ```bash
   docker-compose up -d
   ```
   *The server will be reachable at `http://127.0.0.1:8000`.*

### 4. Run the Desktop Client (recall-app)
1. Open a new terminal and navigate to the app folder:
   ```bash
   cd recall-app
   npm install
   ```
2. Start the Tauri development environment:
   ```bash
   npm run tauri dev
   ```
   *This compiles the Rust native extensions and opens the React desktop frame.*

---

## 📂 Repository Structure

```text
recallos/
├── README.md                  # This root file
├── docs/                      # Extensive project documentation
├── recall-app/                # React + Tauri desktop codebase
│   ├── src/                   # React frontend (components, hooks, utilities)
│   ├── src-tauri/             # Rust desktop bridge (parsers, local LanceDB)
│   └── package.json
└── recall-server/             # Django backend server
    ├── backend/               # Django API endpoints and settings
    ├── ai-services/           # Chunker, OCR, and Ollama/Groq drivers
    ├── docker-compose.yml
    └── requirements.txt
```

---

## 📚 Detailed Documentation

For an in-depth understanding of every subsystem, refer to the documents in the `/docs` directory:

1.  👉 **[Architecture Guide](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/architecture.md)** — High-level components, data streams, and visual processing flows.
2.  👉 **[Project Structure](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/project-structure.md)** — In-depth mapping of directory layouts and codebase boundaries.
3.  👉 **[Data Model](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/data-model.md)** — Specifications of the local LanceDB tables and remote PostgreSQL schemas.
4.  👉 **[API Endpoints](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/api-endpoints.md)** — API endpoints contract, request payloads, and response JSON formats.
5.  👉 **[AI Pipeline](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/ai-pipeline.md)** — Text chunking, BGE-M3 embedding generation, semantic search, and RAG context building.
6.  👉 **[Use Cases](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/use-cases.md)** — User flows, indexing logic, resizable layouts, and scope-based chat routing.
7.  👉 **[Development Guide](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/development-guide.md)** — Setup scripts, developer credentials, and local testing commands.
8.  👉 **[Operations Guide](file:///Users/fedorrumiantsev/work/portfolio/recallos/docs/operations.md)** — Fallback configurations, model aliases, and production checklist.
