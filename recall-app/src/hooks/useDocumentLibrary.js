import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SERVER_PROCESS_ENDPOINT } from "../lib/appConfig";
import { IMAGE_EXTENSIONS, getExtension, getFilename, inferFileType } from "../lib/fileTypes";
import { isDesktop } from "../lib/desktop";
import { buildSmartChunks } from "../utils/documentIntelligence";
import { cacheEmbedding, computeTextHash, getCachedEmbedding } from "../utils/embeddingsCache";
import { generateServerEmbeddingsBatch } from "../utils/embeddings";
import { getFullDocumentContent, normalizeLocalDocument } from "../lib/documentPreview";
import { generateAiDocumentCategory } from "../lib/aiCategory";
import { SUMMARY_GENERATING_TEXT, generateAiDocumentSummary } from "../lib/aiSummary";

const chunksForDetails = (documentId, chunks) => chunks.map((chunk, index) => ({
  id: `chunk-${documentId}-${index}`,
  document_id: documentId,
  content: chunk.content || chunk.text || "",
  chunk_index: index,
  metadata: JSON.stringify(chunk),
}));

const textFromChunks = (chunks) => chunks
  .map((chunk) => (typeof chunk === "string" ? chunk : chunk.content || chunk.text || ""))
  .filter((content) => content.trim())
  .join("\n\n");

const modelProfileForExtension = (extension) => (
  IMAGE_EXTENSIONS.has(extension) || extension === "pdf" ? "vision" : "text"
);

export function useDocumentLibrary({ onNotify } = {}) {
  const [documents, setDocuments] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [selectedDocDetails, setSelectedDocDetails] = useState(null);
  const [isLoadingDocDetails, setIsLoadingDocDetails] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const refreshLocalDocuments = async () => {
    if (!isDesktop()) {
      setDocuments([]);
      return [];
    }

    const localDocs = await invoke("list_local_documents");
    const normalized = localDocs.map(normalizeLocalDocument);
    setDocuments(normalized);
    return normalized;
  };

  const saveLocalDocument = async (doc) => {
    const normalized = normalizeLocalDocument(doc);
    await invoke("upsert_local_document", { document: normalized });
    setDocuments((prev) => [normalized, ...prev.filter((item) => item.id !== normalized.id)]);
    if (selectedDocId === normalized.id) {
      setSelectedDocDetails((prev) =>
        normalizeLocalDocument({ ...(prev || {}), ...normalized, chunks: prev?.chunks || [] }),
      );
    }
    return normalized;
  };

  const buildUploadFileFromPath = async (filePath) => {
    const localFile = await invoke("read_file_bytes", { path: filePath });
    const bytes = new Uint8Array(localFile.bytes);
    return new File([bytes], localFile.filename || getFilename(filePath), {
      type: "application/octet-stream",
    });
  };

  const processFileOnServer = async (filePath, fileObject) => {
    const formData = new FormData();
    const uploadFileObject = fileObject || (await buildUploadFileFromPath(filePath));
    formData.append("file", uploadFileObject);
    const res = await fetch(SERVER_PROCESS_ENDPOINT, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Server fallback processing failed");
    return data;
  };

  const normalizeIndexedChunks = (filename, text, chunks = []) => {
    if (!Array.isArray(chunks) || chunks.length === 0) return buildSmartChunks(text, { filename });
    if (typeof chunks[0] === "string") return buildSmartChunks(chunks.join("\n\n"), { filename });
    return chunks
      .map((chunk, index) => ({
        content: chunk.content || chunk.text || "",
        chunk_index: Number.isFinite(chunk.chunk_index) ? chunk.chunk_index : index,
        prev_chunk_index: index > 0 ? index - 1 : null,
        next_chunk_index: index < chunks.length - 1 ? index + 1 : null,
        page_number: chunk.page_number || 1,
        section_title: chunk.section_title || "Document",
        section_index: chunk.section_index || 0,
        content_type: chunk.content_type || "paragraph",
        keywords: Array.isArray(chunk.keywords) ? chunk.keywords : [],
        entities: chunk.entities || {},
        filename,
      }))
      .filter((chunk) => chunk.content.trim());
  };

  const persistLocalChunks = async (documentId, filename, chunks) => {
    const dbChunks = [];
    const chunksToEmbed = [];
    const chunkIndicesToEmbed = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = typeof chunks[i] === "string" ? { content: chunks[i], chunk_index: i, filename } : chunks[i];
      const chunkTextContent = chunk.content || chunk.text || "";
      if (!chunkTextContent.trim()) continue;
      const hash = await computeTextHash(chunkTextContent);
      const cachedVector = await getCachedEmbedding(hash);
      dbChunks.push({
        id: `chunk-${documentId}-${i}`,
        document_id: documentId,
        text: chunkTextContent,
        vector: cachedVector,
        hash,
        metadata: { ...chunk, content: undefined, text: undefined, chunk_index: i, filename, created_at: new Date().toISOString() },
      });
      if (!cachedVector) {
        chunksToEmbed.push(chunkTextContent);
        chunkIndicesToEmbed.push(dbChunks.length - 1);
      }
    }

    const batchSize = 16;
    for (let offset = 0; offset < chunksToEmbed.length; offset += batchSize) {
      const batchTexts = chunksToEmbed.slice(offset, offset + batchSize);
      const batchIndices = chunkIndicesToEmbed.slice(offset, offset + batchSize);
      const batchVectors = await generateServerEmbeddingsBatch(batchTexts);
      for (let j = 0; j < batchVectors.length; j++) {
        const dbChunkIndex = batchIndices[j];
        const vector = batchVectors[j];
        dbChunks[dbChunkIndex].vector = vector;
        if (vector) await cacheEmbedding(dbChunks[dbChunkIndex].hash, vector);
      }
    }

    await invoke("insert_document_chunks", {
      documentId,
      chunks: dbChunks.map((chunk) => ({
        id: chunk.id,
        document_id: chunk.document_id,
        text: chunk.text,
        vector: chunk.vector,
        metadata: JSON.stringify(chunk.metadata),
      })),
    });
  };

  const uploadLocalFile = async (filePath, fileObject) => {
    setIsUploading(true);
    const filename = getFilename(filePath || fileObject?.name || "document");
    const extension = getExtension(filename);
    const modelProfile = modelProfileForExtension(extension);
    const now = new Date().toISOString();
    const newDocId = `local-${Date.now()}`;

    try {
      let localDoc = await saveLocalDocument({
        id: newDocId,
        filename,
        file_type: inferFileType(filename),
        status: "processing",
        summary: "",
        suggested_title: filename,
        category: "",
        tags: [],
        file_path: filePath || "",
        created_at: now,
        updated_at: now,
      });
      setSelectedDocId(newDocId);
      setSelectedDocDetails({ ...localDoc, chunks: [] });

      let text = "";
      let chunks = [];
      let metadata = {};
      const mustUseServerFallback = IMAGE_EXTENSIONS.has(extension);
      if (!mustUseServerFallback) {
        try {
          text = await invoke("parse_file", { path: filePath });
          chunks = buildSmartChunks(text, { filename });
          if (!text.trim() || chunks.length === 0) throw new Error("Extracted file content is empty or unsupported.");
        } catch {
          text = "";
          chunks = [];
          metadata = await processFileOnServer(filePath, fileObject);
        }
      } else {
        metadata = await processFileOnServer(filePath, fileObject);
      }

      if (metadata.text || metadata.chunks) {
        text = metadata.text || "";
        chunks = Array.isArray(metadata.chunks) && metadata.chunks.length > 0
          ? normalizeIndexedChunks(filename, text, metadata.chunks)
          : buildSmartChunks(text, { filename });
        if (chunks.length === 0) throw new Error("Server fallback did not return indexable text chunks.");
      }

      const summarizingDoc = await saveLocalDocument({
        ...localDoc,
        status: "summarizing",
        summary: SUMMARY_GENERATING_TEXT,
        suggested_title: metadata.suggested_title || filename,
        category: "",
        tags: Array.isArray(metadata.tags) ? metadata.tags : ["AI-Ingested"],
        updated_at: new Date().toISOString(),
      });

      setSelectedDocId(newDocId);
      setSelectedDocDetails({ ...summarizingDoc, chunks: chunksForDetails(newDocId, chunks) });

      let summaryText = "";
      try {
        summaryText = await generateAiDocumentSummary({
          filename,
          text: text || textFromChunks(chunks),
          modelProfile,
        });
      } catch (summaryError) {
        console.error("AI summary generation failed:", summaryError);
        onNotify?.({
          type: "error",
          message: "Document was loaded, but AI summary could not be generated.",
        });
      }

      let category = "General";
      if (summaryText) {
        try {
          category = await generateAiDocumentCategory({
            filename,
            summary: summaryText,
            chunks,
            modelProfile,
          });
        } catch (categoryError) {
          console.error("AI category generation failed:", categoryError);
        }
      }

      const indexedDoc = await saveLocalDocument({
        ...summarizingDoc,
        status: "indexed_text",
        summary: summaryText,
        category,
        updated_at: new Date().toISOString(),
      });

      setSelectedDocDetails({ ...indexedDoc, chunks: chunksForDetails(newDocId, chunks) });
      setIsUploading(false);

      const indexingDoc = await saveLocalDocument({
        ...indexedDoc,
        status: "indexing_vectors",
        updated_at: new Date().toISOString(),
      });
      await persistLocalChunks(newDocId, filename, chunks);
      const processedDoc = await saveLocalDocument({
        ...indexingDoc,
        status: "processed",
        updated_at: new Date().toISOString(),
      });

      try {
        const detail = await invoke("get_local_document", { documentId: newDocId });
        setSelectedDocDetails(normalizeLocalDocument(detail));
      } catch {
        setSelectedDocDetails({ ...processedDoc, chunks: chunksForDetails(newDocId, chunks) });
      }
    } catch (err) {
      console.error("Local document ingestion pipeline failed:", err);
      const failedDoc = await saveLocalDocument({
        id: newDocId,
        filename,
        file_type: inferFileType(filename),
        status: "failed",
        summary: err.message,
        suggested_title: filename,
        category: "General",
        tags: [],
        file_path: filePath || "",
        created_at: now,
        updated_at: new Date().toISOString(),
      });
      setSelectedDocId(newDocId);
      setSelectedDocDetails({ ...failedDoc, chunks: [] });
      alert("Failed to index local document: " + err.message);
      setIsUploading(false);
    }
  };

  const uploadFile = async (file) => {
    alert(`Client-first indexing requires the desktop app. Could not index ${file?.name || "this file"} in browser mode.`);
  };

  const triggerUpload = async () => {
    if (isDesktop()) {
      try {
        const filePath = await invoke("select_local_file");
        if (filePath) await uploadLocalFile(filePath, null);
      } catch (err) {
        alert("Failed to open native dialog: " + err.message);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (isDesktop() && file.path) uploadLocalFile(file.path, file);
    else uploadFile(file);
  };

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (isDesktop() && file.path) uploadLocalFile(file.path, file);
    else uploadFile(file);
  };

  const handleSelectDocument = async (doc) => {
    setSelectedDocId(doc.id);
    setIsLoadingDocDetails(true);
    setSelectedDocDetails(null);
    try {
      if (isDesktop()) {
        const data = await invoke("get_local_document", { documentId: doc.id });
        setSelectedDocDetails(normalizeLocalDocument(data));
      } else {
        setSelectedDocDetails({ ...doc, chunks: [] });
      }
    } catch (err) {
      console.error("Error fetching doc details:", err);
      setSelectedDocDetails({ ...doc, chunks: [] });
    } finally {
      setIsLoadingDocDetails(false);
    }
  };

  const handleDeleteDoc = async (docId, event) => {
    event?.stopPropagation();
    event?.preventDefault();

    const previousDocuments = documents;
    const wasSelected = selectedDocId === docId || selectedDocDetails?.id === docId;

    setDocuments((prev) => prev.filter((doc) => doc.id !== docId));
    if (wasSelected) {
      setSelectedDocId(null);
      setSelectedDocDetails(null);
    }

    try {
      if (isDesktop()) {
        await invoke("delete_local_document", { documentId: docId });
      }
    } catch (err) {
      console.error("Error deleting local document:", err);
      alert("Error deleting document: " + err.message);
      try {
        await refreshLocalDocuments();
      } catch {
        setDocuments(previousDocuments);
      }
    }
  };

  const handleRegenerateSummary = async (docId) => {
    const listDoc = documents.find((doc) => doc.id === docId);
    let detailDoc = selectedDocDetails?.id === docId ? selectedDocDetails : null;
    let targetDoc = null;
    let previousDoc = null;

    try {
      if (!detailDoc && isDesktop()) {
        detailDoc = normalizeLocalDocument(await invoke("get_local_document", { documentId: docId }));
      }

      targetDoc = normalizeLocalDocument({ ...(listDoc || {}), ...(detailDoc || {}) });
      const documentText = getFullDocumentContent(targetDoc).trim();
      if (!documentText) {
        throw new Error("Document text is not available for summary regeneration.");
      }

      previousDoc = {
        ...targetDoc,
        status: targetDoc.status === "summarizing" ? "processed" : targetDoc.status || "processed",
        summary: targetDoc.summary === SUMMARY_GENERATING_TEXT ? "" : targetDoc.summary || "",
      };
      const summarizingDoc = normalizeLocalDocument({
        ...targetDoc,
        status: "summarizing",
        summary: SUMMARY_GENERATING_TEXT,
        updated_at: new Date().toISOString(),
      });

      setDocuments((prev) => [summarizingDoc, ...prev.filter((doc) => doc.id !== docId)]);
      if (selectedDocId === docId || selectedDocDetails?.id === docId) {
        setSelectedDocDetails({ ...summarizingDoc, chunks: targetDoc.chunks || [] });
      }

      const summary = await generateAiDocumentSummary({
        filename: targetDoc.filename,
        text: documentText,
        modelProfile: modelProfileForExtension(getExtension(targetDoc.filename || "")),
      });
      let category = previousDoc.category || "General";
      try {
        category = await generateAiDocumentCategory({
          filename: targetDoc.filename,
          summary,
          chunks: targetDoc.chunks || [],
          modelProfile: modelProfileForExtension(getExtension(targetDoc.filename || "")),
        });
      } catch (categoryError) {
        console.error("AI category regeneration failed:", categoryError);
      }

      const updatedDoc = await saveLocalDocument({
        ...summarizingDoc,
        status: previousDoc.status === "summarizing" ? "processed" : previousDoc.status,
        summary,
        category,
        updated_at: new Date().toISOString(),
      });

      if (selectedDocId === docId || selectedDocDetails?.id === docId) {
        setSelectedDocDetails({ ...updatedDoc, chunks: targetDoc.chunks || [] });
      }
    } catch (err) {
      console.error("Error regenerating summary:", err);
      if (previousDoc) {
        const restoredDoc = {
          ...previousDoc,
          updated_at: new Date().toISOString(),
        };
        if (targetDoc?.status === "summarizing" || targetDoc?.summary === SUMMARY_GENERATING_TEXT) {
          try {
            await saveLocalDocument(restoredDoc);
          } catch {
            // State restoration below still keeps the UI out of the loading state.
          }
        }
        setDocuments((prev) => [restoredDoc, ...prev.filter((doc) => doc.id !== restoredDoc.id)]);
        if (selectedDocId === docId || selectedDocDetails?.id === docId) {
          setSelectedDocDetails({ ...restoredDoc, chunks: targetDoc?.chunks || [] });
        }
      }
      onNotify?.({
        type: "error",
        message: "Summary was not regenerated. The previous summary has been restored.",
      });
    }
  };

  const closePreview = () => {
    setSelectedDocId(null);
    setSelectedDocDetails(null);
  };

  return {
    documents,
    setDocuments,
    selectedDocId,
    selectedDocDetails,
    isLoadingDocDetails,
    isUploading,
    isDragOver,
    fileInputRef,
    setIsDragOver,
    refreshLocalDocuments,
    triggerUpload,
    handleFileDrop,
    handleFileSelect,
    handleSelectDocument,
    handleDeleteDoc,
    handleRegenerateSummary,
    closePreview,
  };
}
