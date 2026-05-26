# 📖 RecallOS Documentation Index

This directory contains long-term technical documentation and architectural specifications for the RecallOS monorepo. It details the boundaries, components, pipelines, and local-first workflows of the application.

## 🗂️ Documentation Guide

To understand the system thoroughly, we recommend reviewing the documents in the following order:

1.  📘 **[Architecture](architecture.md)**
    High-level system topology, components (Tauri client, LanceDB, Django backend, Ollama, Groq), request flows, and security boundaries.
2.  📂 **[Project Structure](project-structure.md)**
    Layout of the monorepo codebase (`recall-app` and `recall-server`), subfolders, files, and engineering ownership boundaries.
3.  📊 **[Data Model](data-model.md)**
    Schema definitions for the local LanceDB tables (`documents`, `document_chunks`) and the backend PostgreSQL tables (`ChatSession`, `ChatMessage`).
4.  🌐 **[API Endpoints](api-endpoints.md)**
    Stateless REST API contracts, input-output payloads, process routines, and model management routes.
5.  🤖 **[AI Pipeline](ai-pipeline.md)**
    Text chunking heuristics, embedding generation (BGE-M3), local vector similarity querying, reranking, and semantic context expansion.
6.  💡 **[Use Cases](use-cases.md)**
    Product specifications, local document import workflows, `@`-scoped chat sessions, layouts, and mock developer authentication.
7.  💻 **[Development Guide](development-guide.md)**
    Local machine setup, environment configuration, dependency profiles, and verification commands.
8.  ⚙️ **[Operations Guide](operations.md)**
    Runtime checks, Docker configuration, host networking rules, fallback procedures, and model overrides.

---

## ✍️ Documentation Policies

*   **Single-Concern Files**: Keep each technical topic in its own file. Avoid creating monolithic wiki documents.
*   **Keep in Sync**: Update the API contracts (`api-endpoints.md`) immediately when modifying views/endpoints in `recall-server`.
*   **Database Migrations**: Document any LanceDB schema shifts or Django PostgreSQL models in `data-model.md` alongside your code change.
*   **Concrete Over Abstract**: Prefer showing real JSON payloads, terminal commands, directory configurations, and code files over abstract diagrams.
