import { FileCode, FileText, Image as ImageIcon } from "lucide-react";
import { classNames } from "../classNames";
import styles from "./FileTypeIcon.module.css";

export function FileTypeIcon({ type, size = 20 }) {
  switch (type) {
    case "pdf":
      return <FileText className={classNames(styles.icon, styles.pdf)} size={size} />;
    case "image":
      return <ImageIcon className={classNames(styles.icon, styles.image)} size={size} />;
    case "markdown":
      return <FileCode className={classNames(styles.icon, styles.markdown)} size={size} />;
    default:
      return <FileText className={classNames(styles.icon, styles.text)} size={size} />;
  }
}
