import { classNames } from "../classNames";
import styles from "./Skeleton.module.css";

export function Skeleton({ count = 1, variant = "card", className = "" }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={classNames(
            "skeleton-glimmer",
            variant === "avatar" ? styles.avatar : styles.card,
            className,
          )}
        >
          {variant === "card" && (
            <>
              <div className={classNames("skeleton-glimmer", styles.line, styles.title)} />
              <div className={classNames("skeleton-glimmer", styles.line, styles.wide)} />
              <div className={classNames("skeleton-glimmer", styles.line, styles.medium)} />
            </>
          )}
        </div>
      ))}
    </>
  );
}
