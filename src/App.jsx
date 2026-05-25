import { useState } from "react";
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
import styles from "./App.module.css";

export default function App() {
  const debugMode = isDebugMode();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");

  const { theme, setTheme } = useTheme();
  const { isAuthenticated, signIn, signOut } = useAuth();
  const documentLibrary = useDocumentLibrary();
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

  if (!isAuthenticated) {
    return <AuthGate onSignIn={signIn} />;
  }

  return (
    <div className="app-grid">
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

      <main className={styles.main}>
        <SearchBar
          value={documentSearch.searchQuery}
          onChange={documentSearch.setSearchQuery}
          onSubmit={documentSearch.handleSearch}
        />
        <div className={styles.contentArea}>
          <DocumentWorkspace
            doc={documentLibrary.selectedDocDetails}
            isLoading={documentLibrary.isLoadingDocDetails}
            debugMode={debugMode}
            onClose={documentLibrary.closePreview}
          />
          <SearchResultsOverlay
            isOpen={documentSearch.showSearchDropdown}
            isSearching={documentSearch.isSearching}
            results={documentSearch.searchResults}
            onClose={() => documentSearch.setShowSearchDropdown(false)}
            onOpenResult={documentSearch.openResult}
          />
        </div>
      </main>

      <ChatSidebar
        messages={chatWorkspace.chatMessages}
        documents={documentLibrary.documents}
        isSending={chatWorkspace.isSendingMessage}
        inputValue={chatWorkspace.chatInput}
        bottomRef={chatWorkspace.chatBottomRef}
        onInputChange={chatWorkspace.setChatInput}
        onSubmit={chatWorkspace.handleSendMessage}
        onCreateSession={chatWorkspace.handleCreateSession}
        onSelectDocument={documentLibrary.handleSelectDocument}
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
    </div>
  );
}
