import { Plus, Sparkles } from "lucide-react";
import { Button, Panel } from "../../ui";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";
import styles from "./ChatSidebar.module.css";

export function ChatSidebar({
  messages,
  documents,
  isSending,
  inputValue,
  selectedScopeDocumentIds,
  bottomRef,
  onInputChange,
  onSubmit,
  onCreateSession,
  onSelectDocument,
  onSelectDocumentScope,
  onRemoveDocumentScope,
}) {
  return (
    <Panel as="aside" className={styles.sidebar} variant="heavy">
      <div className={styles.header}>
        <div className={styles.title}>
          <Sparkles size={18} className={styles.accentIcon} />
          <span>Intellectual Chat</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onCreateSession}>
          <Plus size={14} />
          <span>New</span>
        </Button>
      </div>
      <MessageList
        messages={messages}
        documents={documents}
        isSending={isSending}
        bottomRef={bottomRef}
        onSelectDocument={onSelectDocument}
      />
      <ChatInput
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
        documents={documents}
        selectedDocumentIds={selectedScopeDocumentIds}
        onSelectDocumentScope={onSelectDocumentScope}
        onRemoveDocumentScope={onRemoveDocumentScope}
      />
    </Panel>
  );
}
