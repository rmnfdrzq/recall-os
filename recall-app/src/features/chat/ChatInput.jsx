import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileText, Send, X } from "lucide-react";
import { Button, Chip } from "../../ui";
import {
  findActiveDocumentMention,
  getDocumentLabel,
  getDocumentMentionRanges,
  getDocumentMentionSuggestions,
  insertDocumentMention
} from "../../utils/chatScope";
import styles from "./ChatInput.module.css";

const MAX_INPUT_HEIGHT = 176;
const MIN_INPUT_HEIGHT = 96;

const renderMentionOverlay = (value, documents) => {
  const ranges = getDocumentMentionRanges(value, documents);
  if (!ranges.length) return value;

  const parts = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor) {
      parts.push(value.slice(cursor, range.start));
    }
    parts.push(
      <span key={`${range.document.id}-${range.start}`} className={styles.mentionToken}>
        {value.slice(range.start, range.end)}
      </span>
    );
    cursor = range.end;
  });
  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }
  return parts;
};

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
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const pendingCursorIndex = useRef(null);
  const overlayRef = useRef(null);
  const activeMention = findActiveDocumentMention(value, cursorIndex);
  const selectedSet = useMemo(() => new Set(selectedDocumentIds), [selectedDocumentIds]);
  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedSet.has(document.id)),
    [documents, selectedSet],
  );
  const suggestions = useMemo(() => {
    if (!activeMention) return [];
    return getDocumentMentionSuggestions(documents, activeMention.query);
  }, [activeMention, documents]);

  useEffect(() => {
    if (pendingCursorIndex.current === null) return;
    const nextCursor = pendingCursorIndex.current;
    pendingCursorIndex.current = null;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    if (overlayRef.current && inputRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
      overlayRef.current.scrollTop = inputRef.current.scrollTop;
    }
    setCursorIndex(nextCursor);
  }, [value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = "0px";
    const nextHeight = Math.min(Math.max(input.scrollHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";

    if (overlayRef.current) {
      overlayRef.current.scrollTop = input.scrollTop;
      overlayRef.current.scrollLeft = input.scrollLeft;
    }
  }, [value]);

  const handleChange = (event) => {
    setCursorIndex(event.target.selectionStart ?? event.target.value.length);
    onChange(event.target.value);
  };

  const syncOverlayScroll = (event) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = event.target.scrollLeft;
      overlayRef.current.scrollTop = event.target.scrollTop;
    }
  };

  const handleSelectSuggestion = (document) => {
    onSelectDocumentScope?.(document.id);
    const next = insertDocumentMention(value, activeMention, document);
    pendingCursorIndex.current = next.cursorIndex;
    onChange(next.value);
    setCursorIndex(next.cursorIndex);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && activeMention && suggestions.length > 0) {
      event.preventDefault();
      handleSelectSuggestion(suggestions[0]);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      formRef.current?.requestSubmit();
      return;
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
      <form ref={formRef} className={styles.form} onSubmit={onSubmit}>
        <div className={styles.inputArea}>
          <div ref={overlayRef} className={styles.mentionOverlay} aria-hidden="true">
            {value ? renderMentionOverlay(value, documents) : "\u00a0"}
          </div>
          <textarea
            ref={inputRef}
            className={styles.mentionInput}
            value={value}
            onChange={handleChange}
            onScroll={syncOverlayScroll}
            onKeyDown={handleKeyDown}
            onClick={(event) => setCursorIndex(event.target.selectionStart ?? value.length)}
            onKeyUp={(event) => setCursorIndex(event.target.selectionStart ?? value.length)}
            placeholder="Ask AI about your uploaded data..."
            rows={1}
            spellCheck="true"
            aria-label="Ask AI about your uploaded data"
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
          <Button type="submit" className={styles.send} aria-label="Send message"><Send size={18} /></Button>
        </div>
      </form>
    </div>
  );
}
