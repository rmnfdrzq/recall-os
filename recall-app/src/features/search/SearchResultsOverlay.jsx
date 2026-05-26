import { Search, Sparkles } from "lucide-react";
import { Button, Panel, Skeleton } from "../../ui";
import { SearchResultCard } from "./SearchResultCard";
import styles from "./SearchResultsOverlay.module.css";

export function SearchResultsOverlay({ isSearching, results, onClose, onOpenResult }) {
  return (
    <Panel as="section" className={styles.results} variant="heavy">
      <div className={styles.header}>
        <h2 className={styles.title}>
          <Sparkles size={18} className={styles.accentIcon} />
          <span>Semantic Search Results</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>Close Results</Button>
      </div>
      <div className={styles.list}>
        {isSearching ? (
          <Skeleton count={2} />
        ) : results.length === 0 ? (
          <div className={styles.empty}>
            <Search size={40} />
            <div>
              <strong>No results found</strong>
              <div>Try another keyword or naturally phrased query.</div>
            </div>
          </div>
        ) : (
          results.map((result, index) => (
            <SearchResultCard key={result.id || index} result={result} onClick={onOpenResult} />
          ))
        )}
      </div>
    </Panel>
  );
}
