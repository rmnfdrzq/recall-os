import { Folder, Sparkles } from "lucide-react";
import { Panel, Skeleton } from "../../ui";
import { DebugChunks } from "./DebugChunks";
import { DocumentHeader } from "./DocumentHeader";
import { DocumentPreview } from "./DocumentPreview";
import { DocumentSummary } from "./DocumentSummary";
import styles from "./DocumentWorkspace.module.css";

export function DocumentWorkspace({ doc, isLoading, debugMode, onClose, onRegenerateSummary }) {
  return (
    <Panel className={styles.workspace} variant="heavy">
      {isLoading ? (
        <div className={styles.loading}>
          <h2 className={styles.loadingTitle}>
            <Sparkles size={18} className={`animate-pulse-glow ${styles.accentIcon}`} />
            <span>Loading Document...</span>
          </h2>
          <Skeleton count={3} />
        </div>
      ) : doc ? (
        <div className={styles.content}>
          <DocumentHeader doc={doc} onClose={onClose} />
          <DocumentSummary doc={doc} onRegenerate={onRegenerateSummary} />
          <DocumentPreview doc={doc} />
          {debugMode && <DebugChunks chunks={doc.chunks} />}
        </div>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><Folder size={48} /></div>
          <div>
            <h3 className={styles.emptyTitle}>Document Preview Space</h3>
            <p className={styles.emptyText}>
              Select a document from your library on the left to review its content, OCR extraction text, and AI summary.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
