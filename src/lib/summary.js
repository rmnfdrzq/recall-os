export const isMissingSummary = (summary) => {
  const normalized = (summary || "").trim().toLowerCase();
  return (
    !normalized ||
    [
      "no summary generated",
      "no summary generated.",
      "no summary synthesized",
      "no summary synthesized.",
    ].includes(normalized)
  );
};

export const getSummaryText = (doc) => {
  if (!doc) return "";
  if (!isMissingSummary(doc.summary)) return doc.summary;
  if (
    doc.status === "pending" ||
    doc.status === "processing" ||
    doc.status === "indexing_vectors" ||
    doc.status === "indexed_text"
  ) {
    return "AI summary is being generated as part of document processing.";
  }
  return "AI summary has not been generated for this document yet.";
};
