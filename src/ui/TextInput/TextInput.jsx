import { classNames } from "../classNames";
import styles from "./TextInput.module.css";

export function TextInput({ className = "", icon = null, pill = false, ...props }) {
  if (!icon) {
    return <input className={classNames(styles.input, pill && styles.pill, className)} {...props} />;
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.icon}>{icon}</span>
      <input
        className={classNames(styles.input, styles.withIcon, pill && styles.pill, className)}
        {...props}
      />
    </div>
  );
}
