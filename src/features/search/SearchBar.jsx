import { Search } from "lucide-react";
import { Button, Panel, TextInput } from "../../ui";
import styles from "./SearchBar.module.css";

export function SearchBar({ value, onChange, onSubmit }) {
  return (
    <Panel className={styles.shell} variant="heavy">
      <form className={styles.form} onSubmit={onSubmit}>
        <TextInput
          pill
          icon={<Search size={18} />}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Smart search across documents and content..."
        />
        <Button type="submit" pill className={styles.button}>Search</Button>
      </form>
    </Panel>
  );
}
