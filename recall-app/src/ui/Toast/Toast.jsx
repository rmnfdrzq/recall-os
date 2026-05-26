import { X } from "lucide-react";
import { useEffect } from "react";
import { IconButton } from "../IconButton";
import { classNames } from "../classNames";
import styles from "./Toast.module.css";

export function Toast({
  message,
  type = "error",
  duration = 5000,
  onClose,
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onClose?.();
    }, duration);

    return () => window.clearTimeout(timer);
  }, [duration, onClose]);

  if (!message) return null;

  return (
    <div className={classNames(styles.toast, styles[type])} role="status" aria-live="polite">
      <div className={styles.content}>
        <span className={styles.message}>{message}</span>
        <IconButton
          aria-label="Close notification"
          className={styles.close}
          onClick={onClose}
        >
          <X size={14} />
        </IconButton>
      </div>
      <div
        className={styles.progress}
        style={{ animationDuration: `${duration}ms` }}
      />
    </div>
  );
}
