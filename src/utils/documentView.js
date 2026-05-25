export const normalizeLocalDocument = (doc) => {
  if (!doc) return {};
  return {
    id: doc.id || "",
    filename: doc.filename || "",
    file_type: doc.file_type || doc.fileType || "",
    status: doc.status || "pending",
    summary: doc.summary || doc.description || "",
    suggested_title:
      doc.suggested_title || doc.suggestedTitle || doc.filename || "",
    category: doc.category || "General",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    file_path: doc.file_path || doc.filePath || doc.file || "",
    created_at: doc.created_at || doc.createdAt || new Date().toISOString(),
    updated_at: doc.updated_at || doc.updatedAt || new Date().toISOString(),
    file: doc.file || doc.file_path || doc.filePath || "",
    chunks: Array.isArray(doc.chunks) ? doc.chunks : [],
  };
};

export const getFullDocumentContent = (doc) => {
  if (!doc) return "";
  if (doc.content) return doc.content;
  if (!doc.chunks || doc.chunks.length === 0) return "";

  const sortedChunks = [...doc.chunks].sort((a, b) => {
    const idxA = typeof a.chunk_index === "number" ? a.chunk_index : 0;
    const idxB = typeof b.chunk_index === "number" ? b.chunk_index : 0;
    return idxA - idxB;
  });

  return sortedChunks.map((c) => c.content || c.text || "").join("\n\n");
};
