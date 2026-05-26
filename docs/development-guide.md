# 💻 Local Development Guide

This guide details machine configuration, environment settings, local mock credentials, and verification commands required to build, test, and run the RecallOS monorepo.

---

## 🛠️ Environment Prerequisites

To configure your development environment, ensure you have the following host dependencies:
*   **Node.js**: v18.x or v20.x (Recommended)
*   **Rust Toolchain**: Stable cargo compiler (Required for Tauri native bindings)
*   **Docker & Compose**: Running daemon for PostgreSQL containerization
*   **Ollama Daemon**: Installed and active on the server host at `http://127.0.0.1:11434`; `recall-server` reaches it through `OLLAMA_BASE_URL`

---

## 📥 Subproject Configurations

RecallOS is organized into two main folders: `recall-app` (frontend & desktop runtime) and `recall-server` (backend & LLM API adapters).

### 1. `recall-server` Setup (Django & AI Services)
1.  Navigate into the server folder:
    ```bash
    cd recall-server
    ```
2.  Duplicate the environment template file:
    ```bash
    cp .env.example .env
    ```
3.  Configure your credentials in `.env`:
    ```ini
    # Core LLM API Provider API Key
    GROQ_API_KEY=your_groq_api_key_here
    
    # Model Mappings
    GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
    OLLAMA_BASE_URL=http://host.docker.internal:11434  # Allows Docker container to reach server-host Ollama
    OLLAMA_EMBEDDING_MODEL=bge-m3
    OLLAMA_LLM_MODEL=gemma4:31b-cloud
    ```
4.  Launch the PostgreSQL and Web containers:
    ```bash
    docker-compose up -d
    ```
    *The web container runs database migrations automatically and exposes the REST API on port `8000`.*

### 2. `recall-app` Setup (React + Tauri)
1.  Navigate to the app folder:
    ```bash
    cd recall-app
    ```
2.  Install Javascript packages:
    ```bash
    npm install
    ```
3.  Launch the desktop workspace in watch mode:
    ```bash
    npm run tauri dev
    ```
    *Tauri compiles the native Rust bridges, initializes local LanceDB coordinates, and opens the React desktop application frame.*

---

## 🔐 Mock Developer Authentication

RecallOS uses a simulated authentication protocol for local development convenience:
*   **Username**: `admin`
*   **Password**: `admin`
*   **Session Token**: Stored inside `localStorage` to mock standard JWT handshakes.
*   **API Clearance**: Backend endpoints are configured with `AllowAny` permissions by default, accelerating local API development.

---

## 🧪 Verification & Testing Commands

To validate changes before pushing them to the repository, run the following verification suites:

### 1. Client-Side Tests (`recall-app`)

*   **Production Build Compile**:
    ```bash
    npm run build
    ```
*   **Linter Checks**:
    ```bash
    npm run lint
    ```
*   **Tauri Rust Layer Checks**:
    ```bash
    cd src-tauri
    cargo check
    ```
*   **Targeted Unit Tests**:
    RecallOS uses Node's native test runner to validate parsing, resizes, and scoping mechanics:
    ```bash
    # Test text chunking, page tagging, and NLP entity extraction
    node --test src/utils/documentIntelligence.test.js
    
    # Test keyword matching, implicit scopes, and explicit @mentions
    node --test src/utils/chatScope.test.js
    
    # Test panel sizing shares and localStorage persistency
    node --test src/utils/resizableLayout.test.js
    ```

### 2. Server-Side Tests (`recall-server`)

*   **Django Unit Tests**:
    To run the backend test suite, navigate to the `backend/` directory and invoke `manage.py` through your virtual environment:
    ```bash
    cd recall-server/backend
    
    # Set local DB environment overrides and run tests
    DB_NAME=recallos_db DB_USER=recallos_admin DB_PASSWORD=admin_secure_password_replace_me DB_HOST=127.0.0.1 DB_PORT=5432 ../backend/.venv/bin/python manage.py test core
    ```
*   **Migrations Health Check**:
    To verify that all models are in sync with active database migrations without writing new migration files:
    ```bash
    DB_NAME=recallos_db DB_USER=recallos_admin DB_PASSWORD=admin_secure_password_replace_me DB_HOST=127.0.0.1 DB_PORT=5432 ../backend/.venv/bin/python manage.py makemigrations --check --dry-run
    ```
