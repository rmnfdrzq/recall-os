import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { API_BASE } from "../lib/appConfig";
import { isDesktop } from "../lib/desktop";
import { generateServerEmbedding } from "../utils/embeddings";
import { buildEnhancedContext } from "../utils/documentIntelligence";
import { findReferencedDocuments, getScopedDocuments } from "../utils/chatScope";

export function useChatWorkspace({ documents }) {
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [selectedScopeDocumentIds, setSelectedScopeDocumentIds] = useState([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const chatBottomRef = useRef(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isSendingMessage]);

  const loadSessions = async () => {
    const sessionRes = await fetch(`${API_BASE}/chat/session/`);
    const sessionData = await sessionRes.json();
    setChatSessions(sessionData);

    if (sessionData.length > 0) {
      const firstSessionId = sessionData[0].id;
      setActiveSessionId(firstSessionId);
      const detailRes = await fetch(`${API_BASE}/chat/session/${firstSessionId}/`);
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        setChatMessages(detailData.messages || []);
      }
      return;
    }

    const createRes = await fetch(`${API_BASE}/chat/session/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Default Workspace Chat" }),
    });
    if (createRes.ok) {
      const newSession = await createRes.json();
      setChatSessions([newSession]);
      setActiveSessionId(newSession.id);
      setChatMessages([{
        id: "m-init",
        role: "assistant",
        content: "Hello! I am RecallOS AI. I have analyzed your documents in the local library. Ask me any question about them!",
        sources: [],
      }]);
    }
  };

  const handleSelectSession = async (sessionId) => {
    setActiveSessionId(sessionId);
    try {
      const res = await fetch(`${API_BASE}/chat/session/${sessionId}/`);
      const data = await res.json();
      setChatMessages(data.messages || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/chat/session/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Chat Session #${chatSessions.length + 1}` }),
      });
      if (!res.ok) throw new Error("Failed to create a new chat session");
      const data = await res.json();
      setChatSessions((prev) => [data, ...prev]);
      handleSelectSession(data.id);
    } catch (err) {
      alert(err.message);
    }
  };

  const addScopeDocument = (documentId) => {
    setSelectedScopeDocumentIds((prev) => (
      prev.includes(documentId) ? prev : [...prev, documentId]
    ));
  };

  const removeScopeDocument = (documentId) => {
    setSelectedScopeDocumentIds((prev) => prev.filter((id) => id !== documentId));
  };

  const getLocalChatContext = async (query, scopeDocumentIds = []) => {
    if (!isDesktop()) return [];
    try {
      const queryVector = await generateServerEmbedding(query);
      const referencedDocuments = scopeDocumentIds.length > 0 ? [] : findReferencedDocuments(query, documents);
      const effectiveScopeDocumentIds = scopeDocumentIds.length > 0
        ? scopeDocumentIds
        : referencedDocuments.map((document) => document.id);
      const hasExplicitScope = effectiveScopeDocumentIds.length > 0;
      const scopedDocumentIdSet = new Set(effectiveScopeDocumentIds);
      const scopedDocuments = getScopedDocuments(documents, effectiveScopeDocumentIds);
      const localResults = await invoke("search_local_vectors", { queryVector, limit: hasExplicitScope ? 200 : 50 });
      const scopedResults = hasExplicitScope
        ? localResults.filter((item) => scopedDocumentIdSet.has(item.document_id))
        : localResults;
      return await buildEnhancedContext({
        query,
        vectorResults: scopedResults,
        documents: scopedDocuments,
        fetchDocumentDetail: async (documentId) => {
          if (hasExplicitScope && !scopedDocumentIdSet.has(documentId)) return null;
          return await invoke("get_local_document", { documentId });
        },
        maxContextChars: 12000,
      });
    } catch (err) {
      console.warn("Failed to build local chat context; sending message without document context.", err);
      return [];
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput.trim();
    const scopeDocumentIds = [...selectedScopeDocumentIds];
    setChatInput("");
    setSelectedScopeDocumentIds([]);
    setChatMessages((prev) => [...prev, {
      id: `user-msg-${Date.now()}`,
      role: "user",
      content: userText,
      sources: [],
    }]);
    setIsSendingMessage(true);

    try {
      let currentSessionId = activeSessionId;
      if (!currentSessionId) {
        const createRes = await fetch(`${API_BASE}/chat/session/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Default Workspace Chat" }),
        });
        if (!createRes.ok) throw new Error("Failed to create a default chat session");
        const newSession = await createRes.json();
        setChatSessions([newSession]);
        setActiveSessionId(newSession.id);
        currentSessionId = newSession.id;
      }

      const contextChunks = await getLocalChatContext(userText, scopeDocumentIds);
      const res = await fetch(`${API_BASE}/chat/session/${currentSessionId}/message/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userText, context_chunks: contextChunks }),
      });
      if (!res.ok) throw new Error("Failed to append chat message");
      const data = await res.json();
      setChatMessages((prev) => [...prev, data]);
    } catch (err) {
      console.error("Error sending message to RecallOS AI:", err);
      alert(err.message);
    } finally {
      setIsSendingMessage(false);
    }
  };

  return {
    chatSessions,
    activeSessionId,
    chatMessages,
    chatInput,
    selectedScopeDocumentIds,
    isSendingMessage,
    chatBottomRef,
    setChatInput,
    addScopeDocument,
    removeScopeDocument,
    loadSessions,
    handleCreateSession,
    handleSendMessage,
  };
}
