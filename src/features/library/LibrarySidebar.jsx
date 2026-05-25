import { Folder, Settings, Sparkles } from "lucide-react";
import { IconButton, Panel, Skeleton } from "../../ui";
import { DocumentCard } from "./DocumentCard";
import { UploadDropzone } from "./UploadDropzone";
import styles from "./LibrarySidebar.module.css";

export function LibrarySidebar({
  documents,
  selectedDocId,
  isUploading,
  isDragOver,
  fileInputRef,
  onOpenSettings,
  onTriggerUpload,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  onSelectDocument,
  onDeleteDocument,
}) {
  const sortedDocuments = documents.slice().sort(
    (a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0),
  );

  return (
    <Panel as="aside" className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}><Sparkles size={16} color="#fff" /></div>
          <span className={styles.brandText}>RecallOS</span>
        </div>
      </div>
      <div className={styles.dropzoneWrap}>
        <UploadDropzone
          fileInputRef={fileInputRef}
          isDragOver={isDragOver}
          isUploading={isUploading}
          onClick={onTriggerUpload}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onFileSelect={onFileSelect}
        />
      </div>
      <div className={styles.sectionTitle}>
        <Folder size={16} />
        <span>Library ({documents.length})</span>
      </div>
      <div className={styles.list}>
        {isUploading && <Skeleton count={1} />}
        {sortedDocuments.length === 0 ? (
          <div className={styles.empty}>No documents yet. Drag & drop a file here!</div>
        ) : (
          sortedDocuments.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              isSelected={selectedDocId === doc.id}
              onSelect={onSelectDocument}
              onDelete={onDeleteDocument}
            />
          ))
        )}
      </div>
      <div className={styles.footer}>
        <div className={styles.workspace}>
          <div className={styles.workspaceIcon}><Folder size={16} /></div>
          <span className={styles.workspaceText}>Local Workspace</span>
        </div>
        <IconButton onClick={onOpenSettings} title="Settings">
          <Settings size={16} />
        </IconButton>
      </div>
    </Panel>
  );
}
