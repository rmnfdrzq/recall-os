import { useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { Chip, Panel } from "../../ui";
import { inferFileType } from "../../lib/fileTypes";
import { getSummaryText } from "../../lib/summary";
import styles from "./SourceChips.module.css";

export function SourceChips({ sources = [], documents, messageIndex, onSelectDocument }) {
  const [activeSource, setActiveSource] = useState(null);
  const uniqueSources = [];
  const seenDocIds = new Set();
  const seenFilenames = new Set();

  for (const source of sources) {
    const docId = source.document_id || source.documentId;
    const filename = source.filename || source.suggested_title;
    if (docId && seenDocIds.has(docId)) continue;
    if (filename && seenFilenames.has(filename)) continue;
    if (docId) seenDocIds.add(docId);
    if (filename) seenFilenames.add(filename);
    uniqueSources.push(source);
  }

  if (!uniqueSources.length) return null;

  return (
    <div className={styles.chips}>
      {uniqueSources.map((source, index) => {
        const docId = source.document_id || source.documentId;
        const filename = source.filename || source.suggested_title;
        const matchingDoc =
          documents.find((doc) => docId && doc.id === docId) ||
          documents.find((doc) => filename && doc.filename === filename);
        const sourceKey = `${messageIndex}-${index}`;
        const summaryRaw = getSummaryText(matchingDoc);
        const summary = summaryRaw && summaryRaw.length > 160
          ? `${summaryRaw.slice(0, 160)}...`
          : summaryRaw || "No summary available.";

        const handleClick = () => {
          onSelectDocument(matchingDoc || {
            id: docId || `local-${Date.now()}`,
            filename: filename || "Document",
            file_type: inferFileType(filename || ""),
          });
        };

        return (
          <div
            className={styles.source}
            key={sourceKey}
            onMouseEnter={() => setActiveSource(sourceKey)}
            onMouseLeave={() => setActiveSource(null)}
          >
            <Chip onClick={handleClick} title="Click to open document preview">
              <Link2 size={8} />
              {filename}
            </Chip>
            {activeSource === sourceKey && (
              <Panel className={styles.popover} variant="solid">
                <div className={styles.popoverTitle}>
                  <FileText size={12} color="#a78bfa" />
                  <span>{filename}</span>
                </div>
                <p className={styles.summary}>{summary}</p>
                <div className={styles.hint}>Click to open document preview.</div>
              </Panel>
            )}
          </div>
        );
      })}
    </div>
  );
}
