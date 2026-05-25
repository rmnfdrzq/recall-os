import { normalizeText } from "./documentIntelligence.js";

const mentionBoundaryPattern = /[\s([{,;:]/;

const extensionPattern = /\.[^.]+$/;

export const getDocumentLabel = (document) => (
  document?.suggested_title && document.suggested_title !== document.filename
    ? document.suggested_title
    : document?.filename || "Untitled document"
);

export const findActiveDocumentMention = (value = "", cursorIndex = value.length) => {
  const beforeCursor = String(value).slice(0, cursorIndex);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex === -1) return null;
  if (atIndex > 0 && !mentionBoundaryPattern.test(beforeCursor[atIndex - 1])) return null;

  const query = beforeCursor.slice(atIndex + 1);
  if (/[\n\r]/.test(query)) return null;
  if (/\s{2,}/.test(query)) return null;
  if (/[()[\]{}<>]/.test(query)) return null;

  return {
    start: atIndex,
    end: cursorIndex,
    query
  };
};

export const getDocumentMentionSuggestions = (documents = [], query = "", limit = 8) => {
  const normalizedQuery = normalizeText(query);
  return documents
    .filter((document) => document?.status === "processed")
    .filter((document) => {
      if (!normalizedQuery) return true;
      const haystack = normalizeText(`${document.filename || ""} ${document.suggested_title || ""}`);
      return haystack.includes(normalizedQuery);
    })
    .slice(0, limit);
};

const documentAliases = (document) => {
  const aliases = new Set();
  const filename = document?.filename || "";
  const suggestedTitle = document?.suggested_title || "";
  if (filename) {
    aliases.add(filename);
    aliases.add(filename.replace(extensionPattern, ""));
  }
  if (suggestedTitle && suggestedTitle !== filename) {
    aliases.add(suggestedTitle);
  }
  return Array.from(aliases)
    .map((alias) => normalizeText(alias))
    .filter((alias) => alias.length >= 4);
};

export const findReferencedDocuments = (query = "", documents = []) => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  return documents.filter((document) => (
    documentAliases(document).some((alias) => normalizedQuery.includes(alias))
  ));
};

export const getScopedDocuments = (documents = [], selectedDocumentIds = []) => {
  if (!selectedDocumentIds.length) return documents;
  const selected = new Set(selectedDocumentIds);
  return documents.filter((document) => selected.has(document.id));
};

export const removeMentionQuery = (value = "", mention) => {
  if (!mention) return value;
  const before = value.slice(0, mention.start).replace(/\s+$/, "");
  const after = value.slice(mention.end).replace(/^\s+/, "");
  if (!before) return after;
  if (!after) return before;
  return `${before} ${after}`;
};
