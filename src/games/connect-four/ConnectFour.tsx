import { useEffect, useMemo, useState } from "react";
import {
  CONNECT_FOUR_COLUMNS,
  dropConnectFourPiece,
  newConnectFourState,
  parseConnectFourState,
  serializeConnectFourState,
  type ConnectFourState,
} from "./game";
import { chooseConnectFourMove, type GameProvider, type JevInsight } from "../../lib/jev";
import { deleteGame, listGames, saveGame, type GameRecord } from "../../lib/storage";

type Props = {
  apiKey: string | null;
  provider: GameProvider;
  onSettings: () => void;
};

function newId(): string {
  return crypto.randomUUID();
}

function titleFor(date = new Date()): string {
  return `Match · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function statusFor(state: ConnectFourState): string {
  if (state.winner === "red") return "You win";
  if (state.winner === "yellow") return "Jev wins";
  if (state.draw) return "Draw";
  return state.turn === "red" ? "Your move" : "Jev is thinking";
}

export default function ConnectFour({ apiKey, provider, onSettings }: Props) {
  const [state, setState] = useState<ConnectFourState>(() => newConnectFourState());
  const [gameId, setGameId] = useState(() => newId());
  const [gameTitle, setGameTitle] = useState(() => titleFor());
  const [createdAt, setCreatedAt] = useState(() => Date.now());
  const [insight, setInsight] = useState<JevInsight | null>(null);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [thinking, setThinking] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const legalColumns = useMemo(
    () => Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => column).filter((column) => state.board[0][column] === null),
    [state.board],
  );

  useEffect(() => {
    let active = true;
    listGames("connect-four").then((savedGames) => {
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
        void persistGame(newConnectFourState(), id, title, now, null);
      }
      setReady(true);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not open browser storage.");
    });
    return () => { active = false; };
  }, []);

  async function persistGame(
    nextState: ConnectFourState,
    id: string,
    title: string,
    created: number,
    nextInsight: JevInsight | null,
  ): Promise<void> {
    await saveGame({
      id,
      gameType: "connect-four",
      title,
      createdAt: created,
      updatedAt: Date.now(),
      fen: "",
      pgn: nextState.moves.join(","),
      playerColor: "w",
      status: statusFor(nextState),
      insight: nextInsight,
      state: serializeConnectFourState(nextState),
    });
    setGames(await listGames("connect-four"));
  }

  function restoreGame(saved: GameRecord): void {
    try {
      const restored = parseConnectFourState(saved.state ?? "");
      setState(restored);
      setGameId(saved.id);
      setGameTitle(saved.title);
      setCreatedAt(saved.createdAt);
      setInsight(saved.insight);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not restore Connect Four.");
    }
  }

  async function startNewGame(): Promise<void> {
    const now = Date.now();
    const nextState = newConnectFourState();
    const id = newId();
    const title = titleFor(new Date(now));
    setState(nextState);
    setGameId(id);
    setGameTitle(title);
    setCreatedAt(now);
    setInsight(null);
    setError(null);
    await persistGame(nextState, id, title, now, null);
  }

  async function makeJevMove(position: ConnectFourState): Promise<void> {
    if (provider === "opencode" && !apiKey) {
      onSettings();
      setError("Add your OpenCode API key before Jev can move.");
      return;
    }
    setThinking(true);
    setError(null);
    try {
      const response = await chooseConnectFourMove(provider, apiKey, position, legalColumnsFor(position));
      const nextState = dropConnectFourPiece(position, response.choice);
      if (!nextState) throw new Error("Jev selected a full or invalid column.");
      setState(nextState);
      setInsight(response);
      await persistGame(nextState, gameId, gameTitle, createdAt, response);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Jev could not complete the move.");
    } finally {
      setThinking(false);
    }
  }

  async function handleColumn(column: number): Promise<void> {
    if (!ready || thinking || state.turn !== "red" || state.winner || state.draw) return;
    const nextState = dropConnectFourPiece(state, column);
    if (!nextState) return;
    setState(nextState);
    setInsight(null);
    await persistGame(nextState, gameId, gameTitle, createdAt, null);
    if (!nextState.winner && !nextState.draw) await makeJevMove(nextState);
  }

  async function removeGame(id: string): Promise<void> {
    await deleteGame(id);
    setGames(await listGames("connect-four"));
    if (id === gameId) await startNewGame();
  }

  return (
    <>
      <section className="intro">
        <div><span className="eyebrow">✳ &nbsp;DROP. CONNECT. REPEAT.</span><h1>Can Jev play <em>Connect Four?</em></h1></div>
        <p>One column at a time.<br />Let's see who connects first.</p>
      </section>

      <section className="workspace connect-workspace">
        <div className="arena panel connect-arena">
          <div className="arena-header"><span className="eyebrow"><i /> THE ARENA</span><div className="segmented"><button className="selected-button">You vs Jev</button><button disabled>Jev vs Jev</button></div></div>
          <div className="player-line"><PlayerBadge name="Jev 1.13" detail="YELLOW PIECES" dark /></div>
          <div className="connect-board-wrap">
            <div className="column-buttons">{Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => <button key={column} onClick={() => void handleColumn(column)} disabled={!legalColumns.includes(column) || state.turn !== "red" || thinking} aria-label={`Drop in column ${column + 1}`}>↓</button>)}</div>
            <div className="connect-board" role="grid" aria-label="Connect Four board">
              {state.board.flatMap((row, rowIndex) => row.map((cell, column) => <div className="connect-cell" key={`${rowIndex}-${column}`} role="gridcell"><span className={`connect-piece ${cell ?? ""}`} /></div>))}
            </div>
          </div>
          <div className="player-line bottom-player"><PlayerBadge name="You" detail="RED PIECES" /></div>
          <div className="arena-actions"><button className="pause-button" onClick={() => setError("Pause is visual for now—your game is safely saved locally.")}>Ⅱ&nbsp; Pause match</button><button className="icon-button" onClick={() => void startNewGame()} aria-label="New game">↻</button><button className="icon-button" onClick={onSettings} aria-label="Settings">♫</button></div>
          <p className="arena-note">A real API call on every turn. Pause at any time.</p>
        </div>

        <aside className="side-column">
          <section className="decision-card dark-card">
            <div className="card-heading"><span>INSIDE THE DECISION</span><span className="live-pill">{thinking ? "THINKING" : "LIVE RESULT"}</span></div>
            {insight ? <>
              <p className="decision-kicker">YELLOW · {insight.model === "classifier.dev" ? "CLASSIFIER CHOSE" : "JEV CHOSE"}</p><h2>{insight.chosenSan}</h2>
              <p className="decision-detail">{insight.model === "classifier.dev" ? "classifier.dev selected a legal column." : "Jev selected the highest-probability legal column."}</p>
              {insight.candidates.length > 0 && <><div className="choice-heading"><span>TOP CHOICES</span><span>PROBABILITY</span></div><div className="probabilities">{insight.candidates.map((candidate) => <div className="probability-row" key={candidate.uci}><strong>{candidate.san}</strong><span><i style={{ width: `${Math.max(2, candidate.probability * 100)}%` }} /></span><b>{Math.round(candidate.probability * 100)}%</b></div>)}</div></>}
              <div className="decision-metrics"><div><span>API ROUND TRIP</span><strong>{insight.latencyMs} <small>ms</small></strong></div><div><span>CONFIDENCE</span><strong>{insight.confidence === null ? "—" : <>{Math.round(insight.confidence * 100)}<small>%</small></>}</strong></div></div>
            </> : <div className="empty-decision"><span className="empty-star">✳</span><strong>{thinking ? "Jev is reading the board…" : state.winner ? `${state.winner === "red" ? "You" : "Jev"} connected four.` : state.draw ? "The board is full." : "Make the first move."}</strong><p>{thinking ? "A structured choice is on its way back." : "Jev will choose a response after you drop."}</p></div>}
          </section>

          <section className="small-card scene-card"><div className="small-card-heading"><h3>Set the scene</h3><span>⌄</span></div><button className="select-field" onClick={() => void startNewGame()}>Fresh board <span>⌄</span></button><p>Four in a row wins. Make the first move.</p><div className="scene-stats"><span>OPEN COLUMNS <b>{legalColumns.length}</b></span><span>{state.turn === "red" ? "RED" : "YELLOW"} TO MOVE</span></div></section>

          <section className="small-card reel-card"><div className="small-card-heading"><h3>The move reel</h3><span>{state.moves.length} moves</span></div><div className="move-list">{state.moves.length ? state.moves.slice(-8).map((column, index) => <div className="move-row connect-move-row" key={`${column}-${index}`}><span>{state.moves.length - Math.min(8, state.moves.length) + index + 1}.</span><b>{index % 2 === 0 ? "You" : "Jev"}</b><b>Column {column + 1}</b></div>) : <p className="muted">Your drops will appear here.</p>}</div></section>

          <section className="small-card saved-card"><div className="small-card-heading"><h3>Saved locally</h3><span>{games.length}</span></div>{games.slice(0, 3).map((saved) => <div className={`saved-row ${saved.id === gameId ? "current" : ""}`} key={saved.id}><button onClick={() => restoreGame(saved)}><b>{saved.title}</b><small>{saved.status} · {new Date(saved.updatedAt).toLocaleDateString()}</small></button><button onClick={() => void removeGame(saved.id)} aria-label={`Delete ${saved.title}`}>×</button></div>)}{!games.length && <p className="muted">Games are stored in local SQLite.</p>}</section>
        </aside>
      </section>
      {error && <button className="error-toast" onClick={() => setError(null)}>{error}<span>×</span></button>}
      {!ready && <div className="loading">Opening local game lab…</div>}
    </>
  );
}

function legalColumnsFor(state: ConnectFourState): number[] {
  return Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => column).filter((column) => state.board[0][column] === null);
}

function PlayerBadge({ name, detail, dark = false }: { name: string; detail: string; dark?: boolean }) {
  return <div className="player-badge"><span className={`player-icon ${dark ? "dark-icon" : ""}`}>i</span><div><strong>{name}</strong><small>{detail}</small></div><span className="turn-dot" /></div>;
}
