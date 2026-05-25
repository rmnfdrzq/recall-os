import { Send } from "lucide-react";
import { Button, TextInput } from "../../ui";
import styles from "./ChatInput.module.css";

export function ChatInput({ value, onChange, onSubmit }) {
  return (
    <div className={styles.wrap}>
      <form className={styles.form} onSubmit={onSubmit}>
        <TextInput
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask AI about your uploaded data..."
        />
        <Button type="submit" className={styles.send}><Send size={16} /></Button>
      </form>
    </div>
  );
}
