import { classNames } from "../classNames";
import styles from "./Chip.module.css";

export function Chip({ children, className = "", onClick, ...props }) {
  return (
    <span
      className={classNames(styles.chip, onClick && styles.clickable, className)}
      onClick={onClick}
      {...props}
    >
      {children}
    </span>
  );
}
