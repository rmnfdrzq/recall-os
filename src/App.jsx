import { useCallback, useRef, useState } from "react";
import { AuthGate } from "./features/auth";
import { ChatSidebar } from "./features/chat";
import { DocumentWorkspace } from "./features/documents";
import { LibrarySidebar } from "./features/library";
import { SearchBar, SearchResultsOverlay } from "./features/search";
import { SettingsModal } from "./features/settings";
import { useAuth } from "./hooks/useAuth";
import { useChatWorkspace } from "./hooks/useChatWorkspace";
import { useDocumentLibrary } from "./hooks/useDocumentLibrary";
import { useDocumentSearch } from "./hooks/useDocumentSearch";
import { useTheme } from "./hooks/useTheme";
import { useWorkspaceData } from "./hooks/useWorkspaceData";
import { isDebugMode } from "./lib/debug";
import { Toast } from "./ui";
import {
  DEFAULT_LAYOUT_COLUMNS,
  LAYOUT_COLUMNS_STORAGE_KEY,
  columnsToGridTemplate,
  parseStoredLayoutColumns,
  resizeColumns,
  serializeLayoutColumns,
} from "./utils/resizableLayout";
import styles from "./App.module.css";

export default function App() {
  const debugMode = isDebugMode();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [toast, setToast] = useState(null);
  const [layoutColumns, setLayoutColumns] = useState(() => {
    const stored = window.localStorage.getItem(LAYOUT_COLUMNS_STORAGE_KEY);
    return parseStoredLayoutColumns(stored) || DEFAULT_LAYOUT_COLUMNS;
  });
  const [activeResizeHandle, setActiveResizeHandle] = useState(null);
  const gridRef = useRef(null);

  const showToast = useCallback((nextToast) => {
    setToast({
      id: Date.now(),
      duration: 5000,
      ...nextToast,
    });
  }, []);

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  const { theme, setTheme } = useTheme();
  const { isAuthenticated, signIn, signOut } = useAuth();
  const documentLibrary = useDocumentLibrary({ onNotify: showToast });
  const chatWorkspace = useChatWorkspace({ documents: documentLibrary.documents });
  const documentSearch = useDocumentSearch({
    documents: documentLibrary.documents,
    onSelectDocument: documentLibrary.handleSelectDocument,
  });

  useWorkspaceData({
    enabled: isAuthenticated,
    refreshLocalDocuments: documentLibrary.refreshLocalDocuments,
    loadSessions: chatWorkspace.loadSessions,
  });

  const handleSignOut = () => {
    signOut();
    setIsSettingsOpen(false);
  };

  const startColumnResize = useCallback((handle, event) => {
    if (!gridRef.current) return;
    event.preventDefault();
    const gridWidth = gridRef.current.getBoundingClientRect().width;
    const startX = event.clientX;
    const startColumns = [...layoutColumns];
    setActiveResizeHandle(handle);

    const handlePointerMove = (moveEvent) => {
      const deltaPercent = ((moveEvent.clientX - startX) / gridWidth) * 100;
      const nextColumns = resizeColumns({
        columns: startColumns,
        handle,
        deltaPercent,
      });
      setLayoutColumns(nextColumns);
      window.localStorage.setItem(LAYOUT_COLUMNS_STORAGE_KEY, serializeLayoutColumns(nextColumns));
    };

    const stopResize = () => {
      setActiveResizeHandle(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [layoutColumns]);

  if (!isAuthenticated) {
    return <AuthGate onSignIn={signIn} />;
  }

  return (
    <div
      ref={gridRef}
      className={`app-grid ${activeResizeHandle ? styles.resizing : ""}`}
      style={{ "--layout-grid-template": columnsToGridTemplate(layoutColumns) }}
    >
      <LibrarySidebar
        documents={documentLibrary.documents}
        selectedDocId={documentLibrary.selectedDocId}
        isUploading={documentLibrary.isUploading}
        isDragOver={documentLibrary.isDragOver}
        fileInputRef={documentLibrary.fileInputRef}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onTriggerUpload={documentLibrary.triggerUpload}
        onDragOver={(event) => {
          event.preventDefault();
          documentLibrary.setIsDragOver(true);
        }}
        onDragLeave={() => documentLibrary.setIsDragOver(false)}
        onDrop={documentLibrary.handleFileDrop}
        onFileSelect={documentLibrary.handleFileSelect}
        onSelectDocument={documentLibrary.handleSelectDocument}
        onDeleteDocument={documentLibrary.handleDeleteDoc}
      />

      <div
        className={`${styles.resizeHandle} ${activeResizeHandle === "left" ? styles.activeResizeHandle : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize library and preview columns"
        onPointerDown={(event) => startColumnResize("left", event)}
      />

      <main className={styles.main}>
        <SearchBar
          value={documentSearch.searchQuery}
          onChange={documentSearch.setSearchQuery}
          onSubmit={documentSearch.handleSearch}
        />
        <div className={styles.contentArea}>
          {documentSearch.showSearchDropdown ? (
            <SearchResultsOverlay
              isSearching={documentSearch.isSearching}
              results={documentSearch.searchResults}
              onClose={() => documentSearch.setShowSearchDropdown(false)}
              onOpenResult={documentSearch.openResult}
            />
          ) : (
            <DocumentWorkspace
              doc={documentLibrary.selectedDocDetails}
              isLoading={documentLibrary.isLoadingDocDetails}
              debugMode={debugMode}
              onClose={documentLibrary.closePreview}
              onRegenerateSummary={documentLibrary.handleRegenerateSummary}
            />
          )}
        </div>
      </main>

      <div
        className={`${styles.resizeHandle} ${activeResizeHandle === "right" ? styles.activeResizeHandle : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview and AI chat columns"
        onPointerDown={(event) => startColumnResize("right", event)}
      />

      <ChatSidebar
        messages={chatWorkspace.chatMessages}
        documents={documentLibrary.documents}
        isSending={chatWorkspace.isSendingMessage}
        inputValue={chatWorkspace.chatInput}
        selectedScopeDocumentIds={chatWorkspace.selectedScopeDocumentIds}
        bottomRef={chatWorkspace.chatBottomRef}
        onInputChange={chatWorkspace.setChatInput}
        onSubmit={chatWorkspace.handleSendMessage}
        onCreateSession={chatWorkspace.handleCreateSession}
        onSelectDocument={documentLibrary.handleSelectDocument}
        onSelectDocumentScope={chatWorkspace.addScopeDocument}
        onRemoveDocumentScope={chatWorkspace.removeScopeDocument}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        activeTab={settingsTab}
        theme={theme}
        onTabChange={setSettingsTab}
        onThemeChange={setTheme}
        onClose={() => setIsSettingsOpen(false)}
        onSignOut={handleSignOut}
      />

      {toast && (
        <Toast
          key={toast.id}
          type={toast.type}
          message={toast.message}
          duration={toast.duration}
          onClose={closeToast}
        />
      )}
    </div>
  );
}
