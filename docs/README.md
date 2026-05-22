# RecallOS Documentation

This directory contains long-term technical documentation for maintaining RecallOS.

## Reading Order

1. [Architecture](architecture.md) - system components and request flows.
2. [Project Structure](project-structure.md) - repository layout and ownership boundaries.
3. [Data Model](data-model.md) - Django entities, fields, relationships, and ownership rules.
4. [API Endpoints](api-endpoints.md) - HTTP API contract and examples.
5. [AI Pipeline](ai-pipeline.md) - ingestion, embeddings, OCR, metadata, search, and chat RAG.
6. [Use Cases](use-cases.md) - product behavior from the user's perspective.
7. [Development Guide](development-guide.md) - local workflow and change guidelines.
8. [Operations Guide](operations.md) - runtime checks, model management, backups, and production checklist.

## Documentation Rules

- Keep each topic in its own file.
- Update API docs in the same change as endpoint changes.
- Update data model docs in the same change as migrations.
- Update operations docs when environment variables, ports, services, or model names change.
- Prefer concrete commands and file paths over abstract descriptions.
