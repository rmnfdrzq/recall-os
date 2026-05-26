import { Badge, Panel } from "../../ui";
import styles from "./SearchResultCard.module.css";

export function SearchResultCard({ result, onClick }) {
  const percent = Math.round(result.similarity * 100);
  return (
    <Panel className={styles.card} onClick={() => onClick(result)}>
      <div className={styles.header}>
        <div>
          <Badge>{result.category || "General"}</Badge>{" "}
          <span className={styles.filename}>{result.filename}</span>
        </div>
        <div className={styles.match}>
          <span>{percent}% Match</span>
          <div className={styles.barTrack}>
            <div className={styles.bar} style={{ "--match-width": `${percent}%` }} />
          </div>
        </div>
      </div>
      <p className={styles.content}>{result.content}</p>
    </Panel>
  );
}
