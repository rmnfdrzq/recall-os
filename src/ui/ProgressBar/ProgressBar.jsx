import styles from "./ProgressBar.module.css";

export function ProgressBar({ value = 0 }) {
  return (
    <div className={styles.track}>
      <div className={styles.bar} style={{ "--progress": `${value}%` }} />
    </div>
  );
}
