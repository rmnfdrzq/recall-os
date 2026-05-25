import { Panel } from "../../ui";
import { SourceChips } from "./SourceChips";
import styles from "./ChatMessage.module.css";

export function ChatMessage({ message, messageIndex, documents, onSelectDocument }) {
  const isUser = message.role === "user";
  return (
    <div className={`${styles.message} ${isUser ? styles.user : ""}`}>
      <Panel className={styles.bubble}>
        <p className={styles.content}>{message.content}</p>
      </Panel>
      <SourceChips
        sources={message.sources}
        documents={documents}
        messageIndex={messageIndex}
        onSelectDocument={onSelectDocument}
      />
    </div>
  );
}
