import { classNames } from "../classNames";
import styles from "./Badge.module.css";

export function Badge({ children, className = "", color, background, icon = null }) {
  const style = color || background ? { "--badge-color": color, "--badge-bg": background } : undefined;
  return (
    <span className={classNames(styles.badge, style && styles.status, className)} style={style}>
      {icon}
      {children}
    </span>
  );
}
