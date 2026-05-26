import { SUMMARY_GENERATING_TEXT } from "./summaryConstants.js";

export const isMissingSummary = (summary) => {
  const normalized = (summary || "").trim().toLowerCase();
  return (
    !normalized ||
    [
      SUMMARY_GENERATING_TEXT.toLowerCase(),
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
    doc.status === "summarizing" ||
    doc.status === "indexing_vectors" ||
    doc.status === "indexed_text"
  ) {
    return SUMMARY_GENERATING_TEXT;
  }
  return "AI summary has not been generated for this document yet.";
};
