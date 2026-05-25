import { useMemo, useState } from "react";
import { FileText, Send, X } from "lucide-react";
import { Button, Chip, TextInput } from "../../ui";
import {
  findActiveDocumentMention,
  getDocumentLabel,
  getDocumentMentionSuggestions,
  removeMentionQuery
} from "../../utils/chatScope";
import styles from "./ChatInput.module.css";

export function ChatInput({
  value,
  onChange,
  onSubmit,
  documents = [],
  selectedDocumentIds = [],
  onSelectDocumentScope,
  onRemoveDocumentScope,
}) {
  const [cursorIndex, setCursorIndex] = useState(value.length);
  const activeMention = findActiveDocumentMention(value, cursorIndex);
  const selectedSet = useMemo(() => new Set(selectedDocumentIds), [selectedDocumentIds]);
  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedSet.has(document.id)),
    [documents, selectedSet],
  );
  const suggestions = useMemo(() => {
    if (!activeMention) return [];
    return getDocumentMentionSuggestions(documents, activeMention.query)
      .filter((document) => !selectedSet.has(document.id));
  }, [activeMention, documents, selectedSet]);

  const handleChange = (event) => {
    setCursorIndex(event.target.selectionStart ?? event.target.value.length);
    onChange(event.target.value);
  };

  const handleSelectSuggestion = (document) => {
    onSelectDocumentScope?.(document.id);
    const nextValue = removeMentionQuery(value, activeMention);
    onChange(nextValue);
    setCursorIndex(nextValue.length);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && activeMention && suggestions.length > 0) {
      event.preventDefault();
      handleSelectSuggestion(suggestions[0]);
    }
    if (event.key === "Escape" && activeMention) {
      setCursorIndex(0);
    }
  };

  return (
    <div className={styles.wrap}>
      {selectedDocuments.length > 0 && (
        <div className={styles.scopeChips} aria-label="Selected documents for this question">
          {selectedDocuments.map((document) => (
            <Chip key={document.id} className={styles.scopeChip}>
              <FileText size={10} />
              <span>{getDocumentLabel(document)}</span>
              <button
                type="button"
                className={styles.removeScope}
                onClick={() => onRemoveDocumentScope?.(document.id)}
                aria-label={`Remove ${getDocumentLabel(document)} from chat scope`}
              >
                <X size={10} />
              </button>
            </Chip>
          ))}
        </div>
      )}
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.inputArea}>
          <TextInput
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onClick={(event) => setCursorIndex(event.target.selectionStart ?? value.length)}
            onKeyUp={(event) => setCursorIndex(event.target.selectionStart ?? value.length)}
            placeholder="Ask AI about your uploaded data..."
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
          />
          {activeMention && (
            <div className={styles.suggestions} role="listbox">
              {suggestions.length > 0 ? suggestions.map((document) => (
                <button
                  type="button"
                  key={document.id}
                  className={styles.suggestion}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectSuggestion(document)}
                  role="option"
                >
                  <FileText size={14} />
                  <span className={styles.suggestionText}>
                    <strong>{getDocumentLabel(document)}</strong>
                    <span>{document.filename}</span>
                  </span>
                </button>
              )) : (
                <div className={styles.emptySuggestion}>No matching processed documents</div>
              )}
            </div>
          )}
        </div>
        <Button type="submit" className={styles.send}><Send size={16} /></Button>
      </form>
    </div>
  );
}
