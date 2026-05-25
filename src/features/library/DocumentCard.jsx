import { CheckCircle, Clock, AlertCircle, Trash2 } from "lucide-react";
import { Badge, FileTypeIcon, IconButton, Panel } from "../../ui";
import { getStatusBadgeStyles } from "../../lib/fileTypes";
import styles from "./DocumentCard.module.css";

const statusIcon = (status) => {
  if (status === "processed" || status === "indexed_text") return <CheckCircle size={10} />;
  if (status === "processing" || status === "indexing_vectors") return <Clock size={10} />;
  return <AlertCircle size={10} />;
};

export function DocumentCard({ doc, isSelected, onSelect, onDelete }) {
  const badge = getStatusBadgeStyles(doc.status);
  return (
    <Panel className={`${styles.card} ${isSelected ? styles.selected : ""}`} onClick={() => onSelect(doc)}>
      <div className={styles.body}>
        <div className={styles.icon}><FileTypeIcon type={doc.file_type} /></div>
        <div className={styles.content}>
          <div className={styles.filename}>{doc.filename}</div>
          <div className={styles.badges}>
            {doc.category && <Badge>{doc.category}</Badge>}
            <Badge background={badge.bg} color={badge.color} icon={statusIcon(doc.status)}>
              {badge.label}
            </Badge>
          </div>
          {doc.summary && <div className={styles.summary}>{doc.summary}</div>}
        </div>
      </div>
      <IconButton className={styles.delete} danger onClick={(event) => onDelete(doc.id, event)}>
        <Trash2 size={13} />
      </IconButton>
    </Panel>
  );
}
