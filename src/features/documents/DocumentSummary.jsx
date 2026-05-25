import { RefreshCcw, Sparkles } from "lucide-react";
import { IconButton, Panel } from "../../ui";
import { getSummaryText } from "../../lib/summary";
import styles from "./DocumentSummary.module.css";

export function DocumentSummary({ doc, onRegenerate }) {
  const isGenerating = doc.status === "summarizing";

  return (
    <Panel className={styles.summary}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <Sparkles size={14} />
          <span>AI Summary</span>
        </h3>
        <IconButton
          aria-label="Regenerate summary"
          className={styles.regenerate}
          disabled={isGenerating}
          title="Regenerate summary"
          onClick={() => onRegenerate?.(doc.id)}
        >
          <RefreshCcw size={14} />
        </IconButton>
      </div>
      <p className={styles.text}>{getSummaryText(doc)}</p>
    </Panel>
  );
}
