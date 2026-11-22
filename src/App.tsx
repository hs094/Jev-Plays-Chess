import { useEffect, useState } from "react";
import Chess from "./games/chess/Chess";
import ConnectFour from "./games/connect-four/ConnectFour";
import Dino from "./games/dino/Dino";
import { type GameProvider } from "./lib/jev";
import { loadApiKey, loadProvider, saveApiKey, saveProvider } from "./lib/storage";

type ActiveTab = "chess" | "connect-four" | "dino";

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("chess");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [provider, setProvider] = useState<GameProvider>("opencode");
  const [showSettings, setShowSettings] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadApiKey(), loadProvider()]).then(([savedApiKey, savedProvider]) => {
      setApiKey(savedApiKey);
      setApiKeyInput(savedApiKey ?? "");
      setProvider(savedProvider);
      setShowSettings(savedApiKey === null && savedProvider === "opencode");
      setReady(true);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not open browser storage.");
    });
  }, []);

  async function saveSettings(): Promise<void> {
    await saveProvider(provider);
    if (provider === "opencode") {
      const trimmed = apiKeyInput.trim();
      if (!trimmed) {
        setError("Enter an API key to connect Jev.");
        return;
      }
      await saveApiKey(trimmed);
      setApiKey(trimmed);
    }
    setShowSettings(false);
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◕</span><div><strong>the play lab</strong><small>AN EXPERIMENT WITH JEV 1.13</small></div></div>
        <nav>
          <button className={activeTab === "chess" ? "active" : ""} onClick={() => setActiveTab("chess")}>01&nbsp; Chess</button>
          <button className={activeTab === "connect-four" ? "active" : ""} onClick={() => setActiveTab("connect-four")}>02&nbsp; Connect Four</button>
          <button className={activeTab === "dino" ? "active" : ""} onClick={() => setActiveTab("dino")}>03&nbsp; Dino</button>
        </nav>
        <button className="text-button" onClick={() => setShowSettings(true)}>Under the hood&nbsp; ↗</button>
      </header>

      {activeTab === "chess" && <Chess apiKey={apiKey} provider={provider} onSettings={() => setShowSettings(true)} />}
      {activeTab === "connect-four" && <ConnectFour apiKey={apiKey} provider={provider} onSettings={() => setShowSettings(true)} />}
      {activeTab === "dino" && <Dino apiKey={apiKey} provider={provider} onSettings={() => setShowSettings(true)} />}

      {error && <button className="error-toast" onClick={() => setError(null)}>{error}<span>×</span></button>}
      {!ready && <div className="loading">Opening local game lab…</div>}
      {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><section className="settings-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">✳ &nbsp;UNDER THE HOOD</span><h2>Choose your player</h2></div><button onClick={() => setShowSettings(false)}>×</button></div><p>{provider === "opencode" ? "Use your OpenCode Zen API key for Jev 1.13 Free. It is encrypted before being stored in this browser's local SQLite database." : "classifier.dev chooses actions using Jev behind a simple classifier endpoint."}</p><div className="segmented" aria-label="Move provider"><button className={provider === "opencode" ? "selected-button" : ""} onClick={() => setProvider("opencode")}>OpenCode</button><button className={provider === "classifier" ? "selected-button" : ""} onClick={() => setProvider("classifier")}>classifier.dev</button></div>{provider === "opencode" && <label>OpenCode API key<input type="password" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} placeholder="sk-…" autoFocus /></label>}<div className="settings-actions"><button className="text-button" onClick={() => setShowSettings(false)}>Cancel</button><button className="pause-button compact" onClick={() => void saveSettings()}>Save player</button></div></section></div>}
    </main>
  );
}

export default App;
