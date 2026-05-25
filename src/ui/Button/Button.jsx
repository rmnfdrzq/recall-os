import { classNames } from "../classNames";
import styles from "./Button.module.css";

export function Button({
  children,
  className = "",
  variant = "primary",
  size = "md",
  fullWidth = false,
  pill = false,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      className={classNames(
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        pill && styles.pill,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
