import { forwardRef } from "react";
import { classNames } from "../classNames";
import styles from "./TextInput.module.css";

export const TextInput = forwardRef(function TextInput(
  { className = "", icon = null, pill = false, ...props },
  ref
) {
  if (!icon) {
    return <input ref={ref} className={classNames(styles.input, pill && styles.pill, className)} {...props} />;
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.icon}>{icon}</span>
      <input
        ref={ref}
        className={classNames(styles.input, styles.withIcon, pill && styles.pill, className)}
        {...props}
      />
    </div>
  );
});
