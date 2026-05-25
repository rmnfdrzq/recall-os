import { Sparkles } from "lucide-react";
import { Panel } from "../../ui";
import { getSummaryText } from "../../lib/summary";
import styles from "./DocumentSummary.module.css";

export function DocumentSummary({ doc }) {
  return (
    <Panel className={styles.summary}>
      <h3 className={styles.title}>
        <Sparkles size={14} />
        <span>AI Summary</span>
      </h3>
      <p className={styles.text}>{getSummaryText(doc)}</p>
    </Panel>
  );
}
