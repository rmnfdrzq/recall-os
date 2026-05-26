import { Badge, Button, Chip } from "../../ui";
import styles from "./DocumentHeader.module.css";

export function DocumentHeader({ doc, onClose }) {
  return (
    <>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{doc.filename}</h2>
          <div className={styles.meta}>
            <span className={styles.date}>
              Uploaded {new Date(doc.created_at).toLocaleString("en-US")}
            </span>
            {doc.category && <Badge>{doc.category}</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close Preview</Button>
      </div>
      {doc.tags && doc.tags.length > 0 && (
        <div className={styles.tags}>
          {doc.tags.map((tag) => <Chip key={tag}>#{tag}</Chip>)}
        </div>
      )}
    </>
  );
}
