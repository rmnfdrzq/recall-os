import styles from "./DebugChunks.module.css";

export function DebugChunks({ chunks = [] }) {
  if (!chunks.length) return null;
  return (
    <div>
      <h3 className={styles.title}>Debug: Indexed Text Portions ({chunks.length})</h3>
      <div className={styles.list}>
        {chunks.map((chunk, index) => (
          <div key={chunk.id || index} className={styles.chunk}>
            <div className={styles.meta}>Paragraph #{chunk.chunk_index + 1}</div>
            <p className={styles.text}>{chunk.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
