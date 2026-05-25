import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../lib/desktop";
import { generateServerEmbedding } from "../utils/embeddings";

export function useDocumentSearch({ documents, onSelectDocument }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  const handleSearch = async (event) => {
    if (event) event.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setShowSearchDropdown(true);

    if (!isDesktop()) {
      alert("Client-first semantic search requires the desktop app and local LanceDB index.");
      setIsSearching(false);
      return;
    }

    try {
      const queryVector = await generateServerEmbedding(searchQuery);
      const localResults = await invoke("search_local_vectors", { queryVector, limit: 10 });
      const mappedResults = localResults.map((item) => {
        const matchingDoc = documents.find((doc) => doc.id === item.document_id);
        const similarity = Math.max(0.1, Math.min(1.0, 1.0 - item.score / 2.0));
        return {
          id: item.id,
          document_id: item.document_id,
          category: matchingDoc?.category || "General",
          suggested_title: matchingDoc?.suggested_title || matchingDoc?.filename || "Document Chunk",
          filename: matchingDoc?.filename || "document.pdf",
          similarity,
          content: item.text,
          metadata: item.metadata,
        };
      });
      mappedResults.sort((a, b) => b.similarity - a.similarity);
      setSearchResults(mappedResults);
    } catch (err) {
      console.error("Local semantic search failed:", err);
      alert("Local search error: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const openResult = (result) => {
    const matchingDoc = documents.find((doc) => doc.id === result.document_id);
    if (matchingDoc) {
      onSelectDocument(matchingDoc);
      setShowSearchDropdown(false);
    }
  };

  return {
    searchQuery,
    searchResults,
    isSearching,
    showSearchDropdown,
    setSearchQuery,
    setShowSearchDropdown,
    handleSearch,
    openResult,
  };
}
