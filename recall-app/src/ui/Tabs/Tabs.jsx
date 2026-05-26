import { classNames } from "../classNames";
import styles from "./Tabs.module.css";

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className={styles.tabs}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          className={classNames(styles.tab, value === tab.value && styles.active)}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
