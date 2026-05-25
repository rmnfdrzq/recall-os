import { classNames } from "../classNames";
import styles from "./Panel.module.css";

export function Panel({ as: Component = "div", variant = "default", className = "", ...props }) {
  return (
    <Component
      className={classNames(styles.panel, variant !== "default" && styles[variant], className)}
      {...props}
    />
  );
}
