import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { API_BASE } from "../lib/appConfig";
import { isDesktop } from "../lib/desktop";
import { generateServerEmbedding } from "../utils/embeddings";
import { buildEnhancedContext } from "../utils/documentIntelligence";

export function useChatWorkspace({ documents }) {
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
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

  const getLocalChatContext = async (query) => {
    if (!isDesktop()) return [];
    try {
      const queryVector = await generateServerEmbedding(query);
      const localResults = await invoke("search_local_vectors", { queryVector, limit: 50 });
      return await buildEnhancedContext({
        query,
        vectorResults: localResults,
        documents,
        fetchDocumentDetail: async (documentId) => await invoke("get_local_document", { documentId }),
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
    setChatInput("");
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

      const contextChunks = await getLocalChatContext(userText);
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
    isSendingMessage,
    chatBottomRef,
    setChatInput,
    loadSessions,
    handleCreateSession,
    handleSendMessage,
  };
}
