import os
import sys
import logging
from celery import shared_task
from PyPDF2 import PdfReader

logger = logging.getLogger(__name__)

# System path patch to import from ai-services folder
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # recallos/backend
WORKSPACE_ROOT = os.path.dirname(BASE_DIR) # recallos/
sys.path.append(WORKSPACE_ROOT)
sys.path.append(os.path.join(WORKSPACE_ROOT, 'ai-services'))

# Now import our AI services
from chunker import semantic_chunk_text
from ollama_client import generate_embedding, extract_metadata
from ocr_service import extract_text_from_image


@shared_task
def process_document_pipeline(document_id):
    """
    Asynchronous Celery pipeline that processes uploaded files.
    Text Extraction -> Semantic Chunking -> Vector Embeddings -> pgvector Indexing -> LLM Summary Synthesis.
    """
    from .models import Document, DocumentChunk

    try:
        document = Document.objects.get(pk=document_id)
        logger.info(f"Starting processing pipeline for document: {document.filename}")

        document.status = 'processing'
        document.save()

        file_path = document.file.path
        extracted_text = ""

        # Step 1: Extract text based on file type
        ext = os.path.splitext(document.filename)[1].lower()

        if ext in ['.txt', '.md', '.markdown']:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                extracted_text = f.read()

        elif ext == '.pdf':
            try:
                reader = PdfReader(file_path)
                pages_text = []
                for idx, page in enumerate(reader.pages):
                    page_content = page.extract_text()
                    if page_content:
                        pages_text.append(page_content)
                extracted_text = "\n\n".join(pages_text)

                # Scanned PDF fallback: page rasterization is not implemented yet.
                if not extracted_text.strip():
                    extracted_text = "[Scanned PDF] No digital characters found. (OCR indexing requires page rasterization)."
            except Exception as e:
                logger.error(f"Failed to parse PDF using PyPDF2: {e}")
                extracted_text = f"[PDF Parsing Failed] Original file path: {file_path}. Error: {str(e)}"

        elif ext in ['.png', '.jpg', '.jpeg', '.webp']:
            # Call OCR Service
            extracted_text = extract_text_from_image(file_path)

        else:
            # Fallback for unrecognized formats
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                extracted_text = f.read()

        if not extracted_text.strip():
            extracted_text = f"Empty document content for {document.filename}."

        # Step 2: Semantic Chunking
        chunks = semantic_chunk_text(extracted_text, chunk_size=500, overlap=100)
        logger.info(f"Segmented {document.filename} into {len(chunks)} chunks.")

        # Step 3: Embeddings & Vector Storage
        created_chunks = []
        for idx, chunk_content in enumerate(chunks):
            # Generate embedding using local Ollama model
            vector = generate_embedding(chunk_content)

            # Save DocumentChunk (pgvector)
            chunk_obj = DocumentChunk(
                document=document,
                content=chunk_content,
                chunk_index=idx,
                embedding=vector if vector else None
            )
            created_chunks.append(chunk_obj)

        DocumentChunk.objects.bulk_create(created_chunks)
        logger.info(f"Saved {len(created_chunks)} vector chunks for {document.filename} in database.")

        # Step 4: Metadata Synthesis (Title, Summary, Categories, Tags)
        # Using full text (capped in client utility) to generate tags and category
        metadata = extract_metadata(extracted_text, fallback_title=document.filename)

        suggested_title = metadata.get("suggested_title", "").strip()
        if not suggested_title or suggested_title.lower() in ["untitled", "untitled document", "untitled_document"]:
            from ollama_client import clean_fallback_title
            suggested_title = clean_fallback_title(document.filename)

        document.suggested_title = suggested_title
        document.summary = metadata.get("summary", "No summary synthesized.")
        document.category = metadata.get("category", "General")
        document.tags = metadata.get("tags", ["AI-Ingested"])
        document.status = 'processed'
        document.save()

        logger.info(f"Completed processing pipeline for: {document.filename}")

    except Document.DoesNotExist:
        logger.error(f"Document ID {document_id} not found in database.")
    except Exception as e:
        logger.exception(f"Fatal error in Celery document processing pipeline: {e}")
        try:
            document = Document.objects.get(pk=document_id)
            document.status = 'failed'
            document.summary = f"Pipeline failed: {str(e)}"
            document.save()
        except Exception as save_err:
            logger.error(f"Failed to mark document as failed: {save_err}")
