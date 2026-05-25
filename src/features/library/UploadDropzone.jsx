import { UploadCloud } from "lucide-react";
import { Skeleton } from "../../ui";
import styles from "./UploadDropzone.module.css";

export function UploadDropzone({
  fileInputRef,
  isDragOver,
  isUploading,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
}) {
  return (
    <div
      className={`${styles.dropzone} ${isDragOver ? styles.active : ""}`}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        className={styles.input}
        type="file"
        ref={fileInputRef}
        onChange={onFileSelect}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown"
      />
      {isUploading ? (
        <>
          <Skeleton variant="avatar" />
          <span className={styles.uploading}>Uploading & Processing...</span>
        </>
      ) : (
        <>
          <UploadCloud size={28} className={styles.icon} />
          <div className={styles.title}>Upload File</div>
          <div className={styles.hint}>PDF, Images, Text, MD</div>
        </>
      )}
    </div>
  );
}
