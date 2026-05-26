import { Sparkles } from "lucide-react";
import { Button, Panel, TextInput } from "../../ui";
import styles from "./AuthGate.module.css";

export function AuthGate({ onSignIn }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    const username = event.currentTarget.username.value.trim();
    const password = event.currentTarget.password.value.trim();
    if (!onSignIn(username, password)) {
      alert("Invalid developer credentials! Use 'admin' / 'admin'.");
    }
  };

  return (
    <div className={styles.screen}>
      <Panel className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <Sparkles size={36} />
          </div>
          <div>
            <h1 className={styles.title}>RecallOS</h1>
            <p className={styles.subtitle}>Developer Authentication Portal</p>
          </div>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>Username</span>
            <TextInput name="username" defaultValue="admin" required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <TextInput name="password" type="password" defaultValue="admin" required />
          </label>
          <Button type="submit" fullWidth>Sign In</Button>
        </form>
        <div className={styles.footer}>
          Dev Mode credentials: <strong>admin</strong> / <strong>admin</strong>
        </div>
      </Panel>
    </div>
  );
}
