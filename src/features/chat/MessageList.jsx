import { ChatMessage } from "./ChatMessage";
import { Skeleton } from "../../ui";
import styles from "./MessageList.module.css";

export function MessageList({ messages, documents, isSending, bottomRef, onSelectDocument }) {
  return (
    <div className={styles.list}>
      {messages.map((message, index) => (
        <ChatMessage
          key={message.id || index}
          message={message}
          messageIndex={index}
          documents={documents}
          onSelectDocument={onSelectDocument}
        />
      ))}
      {isSending && (
        <div className={styles.thinking}>
          <Skeleton variant="avatar" />
          <span className="animate-pulse-glow">AI is thinking...</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
