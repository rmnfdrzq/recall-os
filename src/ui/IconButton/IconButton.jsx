import { classNames } from "../classNames";
import styles from "./IconButton.module.css";

export function IconButton({ className = "", danger = false, type = "button", ...props }) {
  return (
    <button
      type={type}
      className={classNames(styles.button, danger && styles.danger, className)}
      {...props}
    />
  );
}
