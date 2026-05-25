import { classNames } from "../classNames";
import styles from "./Modal.module.css";

export function Modal({ children, className = "", width = "640px" }) {
  return (
    <div className={styles.backdrop}>
      <div className={classNames(styles.dialog, className)} style={{ "--modal-width": width }}>
        {children}
      </div>
    </div>
  );
}
