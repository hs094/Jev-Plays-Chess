import { useEffect, useRef, useState, type CSSProperties } from "react";
import { chooseDinoMove, type GameProvider, type JevInsight } from "../../lib/jev";
import { deleteGame, listGames, saveGame, type GameRecord } from "../../lib/storage";
import {
  DINO_TRACK_WIDTH,
  newDinoState,
  parseDinoState,
  serializeDinoState,
  tickDino,
  type DinoState,
} from "./game";

type Props = {
  apiKey: string | null;
  provider: GameProvider;
  onSettings: () => void;
};

function newId(): string {
  return crypto.randomUUID();
}

function titleFor(date = new Date()): string {
  return `Run · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function statusFor(state: DinoState): string {
  return state.gameOver ? `Game over · ${state.score} cacti` : `Running · ${state.score} cacti`;
}

export default function Dino({ apiKey, provider, onSettings }: Props) {
  const [state, setState] = useState<DinoState>(() => newDinoState());
  const [gameId, setGameId] = useState(() => newId());
  const [gameTitle, setGameTitle] = useState(() => titleFor());
  const [createdAt, setCreatedAt] = useState(() => Date.now());
  const [insight, setInsight] = useState<JevInsight | null>(null);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blockedRef = useRef(false);
  const persistedRef = useRef(false);

  useEffect(() => {
    let active = true;
    listGames("dino").then((savedGames) => {
      if (!active) return;
      setGames(savedGames);
      if (savedGames[0]) {
        restoreGame(savedGames[0]);
      } else {
        const now = Date.now();
        const id = newId();
        const title = titleFor(new Date(now));
        setGameId(id);
        setGameTitle(title);
        setCreatedAt(now);
        void persistGame(newDinoState(), id, title, now);
      }
      setReady(true);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not open browser storage.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || state.gameOver) return;
    const timer = window.setInterval(() => setState((current) => tickDino(current)), 50);
    return () => window.clearInterval(timer);
  }, [ready, state.gameOver]);

  useEffect(() => {
    if (apiKey || provider === "classifier") blockedRef.current = false;
  }, [apiKey, provider]);

  useEffect(() => {
    if (!ready || state.gameOver || state.decisionPending || state.obstacle.x > 250) return;
    if (provider === "opencode" && !apiKey) {
      if (!blockedRef.current) {
        blockedRef.current = true;
        onSettings();
        setError("Add your OpenCode API key before Jev can run the Dino.");
      }
      return;
    }

    setState((current) => ({ ...current, decisionPending: true }));
    setError(null);
    void chooseDinoMove(provider, apiKey, state).then((response) => {
      setInsight(response);
      setState((current) => current.gameOver ? current : { ...current, queuedAction: response.choice });
    }).catch((reason: unknown) => {
      setState((current) => ({ ...current, decisionPending: false }));
      setError(reason instanceof Error ? reason.message : "Jev could not choose a Dino action.");
    });
  }, [apiKey, onSettings, provider, ready, state, state.gameOver, state.obstacle.x, state.decisionPending]);

  useEffect(() => {
    if (!ready || !state.gameOver || persistedRef.current) return;
    persistedRef.current = true;
    void persistGame(state, gameId, gameTitle, createdAt);
  }, [createdAt, gameId, gameTitle, ready, state]);

  async function persistGame(nextState: DinoState, id: string, title: string, created: number, nextInsight = insight): Promise<void> {
    await saveGame({
      id,
      gameType: "dino",
      title,
      createdAt: created,
      updatedAt: Date.now(),
      fen: "",
      pgn: String(nextState.score),
      playerColor: "w",
      status: statusFor(nextState),
      insight: nextInsight,
      state: serializeDinoState(nextState),
    });
    setGames(await listGames("dino"));
  }

  function restoreGame(saved: GameRecord): void {
    try {
      const restored = parseDinoState(saved.state ?? "");
      setState(restored);
      setGameId(saved.id);
      setGameTitle(saved.title);
      setCreatedAt(saved.createdAt);
      setInsight(saved.insight);
      persistedRef.current = restored.gameOver;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not restore the Dino run.");
    }
  }

  async function startNewRun(): Promise<void> {
    const now = Date.now();
    const nextState = newDinoState();
    const id = newId();
    const title = titleFor(new Date(now));
    persistedRef.current = false;
    setState(nextState);
    setGameId(id);
    setGameTitle(title);
    setCreatedAt(now);
    setInsight(null);
    setError(null);
    await persistGame(nextState, id, title, now, null);
  }

  async function removeRun(id: string): Promise<void> {
    await deleteGame(id);
    setGames(await listGames("dino"));
    if (id === gameId) await startNewRun();
  }

  return (
    <>
      <section className="intro">
        <div><span className="eyebrow">✳ &nbsp;NO INTERNET. NO PROBLEM.</span><h1>Can Jev run the <em>Dino?</em></h1></div>
        <p>Jev sees the cactus.<br />Jev decides when to jump.</p>
      </section>

      <section className="workspace">
        <div className="arena panel dino-arena">
          <div className="arena-header"><span className="eyebrow"><i /> THE RUN</span><span className="dino-status">{state.gameOver ? "GAME OVER" : state.decisionPending ? "JEV IS WATCHING" : "JEV IS RUNNING"}</span></div>
          <div className="dino-score"><span>SCORE</span><strong>{String(state.score).padStart(5, "0")}</strong></div>
          <div className="dino-track" style={{ "--track-width": `${DINO_TRACK_WIDTH}px` } as CSSProperties}>
            <div className="dino-cloud cloud-one" /><div className="dino-cloud cloud-two" />
            <div className="dino-character" style={{ bottom: `${state.dinoY + 18}px` }}>♞</div>
            <div className="dino-cactus" style={{ left: `${state.obstacle.x}px`, width: `${state.obstacle.width}px`, height: `${state.obstacle.height}px` }}>♟</div>
            <div className="dino-ground" />
          </div>
          <div className="dino-copy">{state.gameOver ? <><strong>Jev hit a cactus.</strong><span>Run complete. Start another autonomous attempt.</span></> : <><strong>Jev is playing independently.</strong><span>Actions are chosen only when an obstacle is close.</span></>}</div>
          <div className="arena-actions"><button className="pause-button" onClick={() => void startNewRun()}>{state.gameOver ? "↻&nbsp; Run again" : "↻&nbsp; New run"}</button><button className="icon-button" onClick={onSettings} aria-label="Settings">♫</button></div>
          <p className="arena-note">A real API call decides every jump. No keyboard required.</p>
        </div>

        <aside className="side-column">
          <section className="decision-card dark-card">
            <div className="card-heading"><span>INSIDE THE DECISION</span><span className="live-pill">{state.decisionPending ? "THINKING" : "LIVE RESULT"}</span></div>
            {insight ? <><p className="decision-kicker">DINO · JEV CHOSE</p><h2>{insight.chosenSan}</h2><p className="decision-detail">Jev chose the next action without human input.</p><div className="decision-metrics"><div><span>API ROUND TRIP</span><strong>{insight.latencyMs} <small>ms</small></strong></div><div><span>CONFIDENCE</span><strong>{insight.confidence === null ? "—" : <>{Math.round(insight.confidence * 100)}<small>%</small></>}</strong></div></div></> : <div className="empty-decision"><span className="empty-star">✳</span><strong>Jev is getting ready.</strong><p>The first cactus will trigger an action.</p></div>}
          </section>
          <section className="small-card scene-card"><div className="small-card-heading"><h3>Set the scene</h3><span>⌄</span></div><button className="select-field" onClick={() => void startNewRun()}>Autonomous run <span>⌄</span></button><p>Chrome's endless runner, with Jev at the controls.</p><div className="scene-stats"><span>CACTI CLEARED <b>{state.score}</b></span><span>SPEED <b>{state.speed.toFixed(1)}</b></span></div></section>
          <section className="small-card saved-card"><div className="small-card-heading"><h3>Saved locally</h3><span>{games.length}</span></div>{games.slice(0, 3).map((saved) => <div className={`saved-row ${saved.id === gameId ? "current" : ""}`} key={saved.id}><button onClick={() => restoreGame(saved)}><b>{saved.title}</b><small>{saved.status} · {new Date(saved.updatedAt).toLocaleDateString()}</small></button><button onClick={() => void removeRun(saved.id)} aria-label={`Delete ${saved.title}`}>×</button></div>)}{!games.length && <p className="muted">Runs are stored in local SQLite.</p>}</section>
        </aside>
      </section>
      {error && <button className="error-toast" onClick={() => setError(null)}>{error}<span>×</span></button>}
      {!ready && <div className="loading">Opening local game lab…</div>}
    </>
  );
}
