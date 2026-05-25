import { Settings, Sparkles } from "lucide-react";
import { Badge, Button, Modal, Panel, Tabs } from "../../ui";
import styles from "./SettingsModal.module.css";

function ThemeSelector({ theme, onThemeChange }) {
  return (
    <div>
      <h3 className={styles.sectionTitle}>Appearance / Theme</h3>
      <div className={styles.themeGrid}>
        <Panel className={`${styles.themeCard} ${theme === "dark" ? styles.selected : ""}`} onClick={() => onThemeChange("dark")}>
          <div className={`${styles.orb} ${styles.darkOrb}`}><Sparkles size={18} color="#a78bfa" /></div>
          <strong>Dark Mode</strong>
          <span className={styles.muted}>Futuristic Deep Space</span>
        </Panel>
        <Panel className={`${styles.themeCard} ${theme === "light" ? styles.selected : ""}`} onClick={() => onThemeChange("light")}>
          <div className={`${styles.orb} ${styles.lightOrb}`}><Sparkles size={18} color="#4f46e5" /></div>
          <strong>Light Mode</strong>
          <span className={styles.muted}>Minimalist Crisp Violet</span>
        </Panel>
      </div>
    </div>
  );
}

function DiagnosticsPanel() {
  return (
    <Panel className={styles.card}>
      <h3 className={styles.sectionTitle}>Diagnostics & Status</h3>
      <div className={styles.row}><span className={styles.muted}>Workspace Mode</span><span className={styles.strong}>Local Connected OS</span></div>
      <div className={styles.row}><span className={styles.muted}>Embedding Engine</span><span className={styles.strong}>Server API (BGE-M3)</span></div>
      <div className={styles.row}><span className={styles.muted}>Vector Database</span><span className={styles.strong}>LanceDB local (1024d)</span></div>
    </Panel>
  );
}

function AccountPanel({ onSignOut }) {
  return (
    <div>
      <h3 className={styles.sectionTitle}>User Credentials</h3>
      <Panel className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.strong}>Logged in as: admin</div>
            <div className={styles.muted}>Dev Mode Bypass Authentication</div>
          </div>
          <Badge>DEVELOPER</Badge>
        </div>
        <Button variant="danger" fullWidth onClick={onSignOut}>Sign Out of RecallOS</Button>
      </Panel>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  activeTab,
  theme,
  onTabChange,
  onThemeChange,
  onClose,
  onSignOut,
}) {
  if (!isOpen) return null;
  return (
    <Modal className={styles.dialog}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          <Settings size={22} className={styles.accentIcon} />
          <span>Workspace Settings</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <Tabs
        value={activeTab}
        onChange={onTabChange}
        tabs={[
          { value: "general", label: "General Settings" },
          { value: "account", label: "Developer Account" },
        ]}
      />
      <div className={styles.content}>
        {activeTab === "general" ? (
          <>
            <ThemeSelector theme={theme} onThemeChange={onThemeChange} />
            <DiagnosticsPanel />
          </>
        ) : (
          <AccountPanel onSignOut={onSignOut} />
        )}
      </div>
      <div className={styles.actions}>
        <Button onClick={onClose}>Save & Dismiss</Button>
      </div>
    </Modal>
  );
}
