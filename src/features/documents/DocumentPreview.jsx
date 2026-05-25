import { CheckCircle } from "lucide-react";
import { getFileUrl, getFullDocumentContent, getPdfPreviewUrl } from "../../lib/documentPreview";
import { renderMarkdownToHtml } from "../../lib/markdown";
import styles from "./DocumentPreview.module.css";

export function DocumentPreview({ doc }) {
  if (!doc) return null;

  if (doc.file_type === "pdf") {
    const url = getPdfPreviewUrl(doc.file);
    return (
      <div className={styles.pdf}>
        <object data={url} type="application/pdf" className={styles.pdfObject} aria-label={doc.filename}>
          <iframe src={url} className={styles.pdfObject} title={doc.filename} />
        </object>
      </div>
    );
  }

  if (doc.file_type === "image") {
    return (
      <div className={styles.imageWrap}>
        <img src={getFileUrl(doc.file)} alt={doc.filename} className={styles.image} />
      </div>
    );
  }

  if (doc.file_type === "markdown") {
    return (
      <div
        className={styles.markdown}
        dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(getFullDocumentContent(doc)) }}
      />
    );
  }

  if (doc.file_type === "text") {
    return <div className={styles.text}>{getFullDocumentContent(doc)}</div>;
  }

  return (
    <div className={styles.fallback}>
      <CheckCircle size={32} className={styles.successIcon} />
      <div>
        <h3>Digitized Text Content</h3>
        <p>This {doc.file_type || "text"} document has been fully OCR-digitized and indexed.</p>
      </div>
    </div>
  );
}
