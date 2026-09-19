import { useEffect, useMemo, useState } from "react";
import { Chess, type Color, type Move, type Piece, type Square } from "chess.js";
import { chooseMove, type GameProvider, type JevInsight } from "./lib/jev";
import {
  deleteGame,
  listGames,
  loadApiKey,
  loadProvider,
  saveApiKey,
  saveGame,
  saveProvider,
  type GameRecord,
} from "./lib/storage";
import { files, formatClock, moveToUci, pieceGlyphs, ranks, squares } from "./lib/chess";

const STARTING_FEN = new Chess().fen();
const HUMAN_COLOR: Color = "w";

type Status = {
  label: string;
  detail: string;
  over: boolean;
};

function gameStatus(game: Chess): Status {
  if (game.isCheckmate()) {
    return {
      label: "Checkmate",
      detail: game.turn() === "w" ? "Jev wins" : "You win",
      over: true,
    };
  }
  if (game.isDraw()) {
    return { label: "Draw", detail: "The position is settled", over: true };
  }
  if (game.isCheck()) {
    return {
      label: "Check",
      detail: game.turn() === HUMAN_COLOR ? "Your king is under attack" : "Jev is in check",
      over: false,
    };
  }
  return {
    label: game.turn() === HUMAN_COLOR ? "Your move" : "Jev is thinking",
    detail: game.turn() === HUMAN_COLOR ? "Choose a piece to begin" : "A real API call on every turn",
    over: false,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

function titleFor(date = new Date()): string {
  return `Match · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function App() {
  const [fen, setFen] = useState(STARTING_FEN);
  const [gameId, setGameId] = useState(() => newId());
  const [gameTitle, setGameTitle] = useState(() => titleFor());
  const [createdAt, setCreatedAt] = useState(() => Date.now());
  const [history, setHistory] = useState<string[]>([]);
  const [insight, setInsight] = useState<JevInsight | null>(null);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [thinking, setThinking] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [provider, setProvider] = useState<GameProvider>("opencode");
  const [showSettings, setShowSettings] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());

  const game = useMemo(() => new Chess(fen), [fen]);
  const status = gameStatus(game);
  const legalMoves = selected ? game.moves({ square: selected, verbose: true }) : [];
  const legalTargets = new Set(legalMoves.map((move) => move.to));
  const currentMoves = useMemo(() => {
    const rows: Array<{ number: number; white?: string; black?: string }> = [];
    history.forEach((move, index) => {
      const row = Math.floor(index / 2);
      if (!rows[row]) rows[row] = { number: row + 1 };
      if (index % 2 === 0) rows[row].white = move;
      else rows[row].black = move;
    });
    return rows;
  }, [history]);

  useEffect(() => {
    let active = true;
    Promise.all([listGames(), loadApiKey(), loadProvider()]).then(([savedGames, savedApiKey, savedProvider]) => {
      if (!active) return;
      setGames(savedGames);
      setApiKey(savedApiKey);
      setApiKeyInput(savedApiKey ?? "");
      setProvider(savedProvider);
      setShowSettings(savedApiKey === null && savedProvider === "opencode");
      if (savedGames[0]) {
        restoreGame(savedGames[0]);
      } else {
        void persistGame({
          id: gameId,
          title: gameTitle,
          createdAt,
          fen: STARTING_FEN,
          pgn: "",
          insight: null,
          status: "New game",
        });
      }
      setReady(true);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not open browser storage.");
    });
    return () => { active = false; };
  }, []);

  function restoreGame(saved: GameRecord): void {
    const restored = new Chess();
    if (saved.pgn) restored.loadPgn(saved.pgn);
    else restored.load(saved.fen);
    setGameId(saved.id);
    setGameTitle(saved.title);
    setCreatedAt(saved.createdAt);
    setFen(saved.fen);
    setHistory(restored.history());
    setInsight(saved.insight);
    setSelected(null);
    setError(null);
  }

  async function persistGame(values: {
    id: string;
    title: string;
    createdAt: number;
    fen: string;
    pgn: string;
    insight: JevInsight | null;
    status: string;
  }): Promise<void> {
    await saveGame({
      ...values,
      updatedAt: Date.now(),
      playerColor: HUMAN_COLOR,
    });
    setGames(await listGames());
  }

  async function startNewGame(): Promise<void> {
    const now = Date.now();
    const id = newId();
    const title = titleFor(new Date(now));
    setGameId(id);
    setGameTitle(title);
    setCreatedAt(now);
    setFen(STARTING_FEN);
    setHistory([]);
    setInsight(null);
    setSelected(null);
    setError(null);
    await persistGame({ id, title, createdAt: now, fen: STARTING_FEN, pgn: "", insight: null, status: "New game" });
  }

  async function makeJevMove(position: Chess): Promise<void> {
    if (provider === "opencode" && !apiKey) {
      setShowSettings(true);
      setError("Add your OpenCode API key before Jev can move.");
      return;
    }

    setThinking(true);
    setError(null);
    try {
      const response = await chooseMove(provider, apiKey, position.fen(), position.pgn(), position.moves({ verbose: true }));
      const move = position.move(response.choice);
      if (!move) throw new Error("Jev selected a move that is no longer legal.");
      setFen(position.fen());
      setHistory(position.history());
      setInsight(response);
      await persistGame({
        id: gameId,
        title: gameTitle,
        createdAt,
        fen: position.fen(),
        pgn: position.pgn(),
        insight: response,
        status: gameStatus(position).label,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Jev could not complete the move.");
    } finally {
      setThinking(false);
    }
  }

  async function handleSquareClick(square: Square): Promise<void> {
    if (!ready || thinking || status.over || game.turn() !== HUMAN_COLOR) return;

    const piece = game.get(square);
    if (selected && legalTargets.has(square)) {
      const next = new Chess(fen);
      const move = next.move({ from: selected, to: square, promotion: "q" });
      setFen(next.fen());
      setHistory(next.history());
      setSelected(null);
      setInsight(null);
      await persistGame({
        id: gameId,
        title: gameTitle,
        createdAt,
        fen: next.fen(),
        pgn: next.pgn(),
        insight: null,
        status: gameStatus(next).label,
      });
      if (move && !gameStatus(next).over) await makeJevMove(next);
      return;
    }

    if (piece?.color === HUMAN_COLOR) setSelected(square);
    else setSelected(null);
  }

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

  async function removeGame(id: string): Promise<void> {
    await deleteGame(id);
    const nextGames = await listGames();
    setGames(nextGames);
    if (id === gameId) await startNewGame();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◕</span>
          <div><strong>the play lab</strong><small>AN EXPERIMENT WITH JEV 1.13</small></div>
        </div>
        <nav><a className="active">01&nbsp; Chess</a><a>02&nbsp; Connect Four</a></nav>
        <button className="text-button" onClick={() => setShowSettings(true)}>Under the hood&nbsp; ↗</button>
      </header>

      <section className="intro">
        <div><span className="eyebrow">✳ &nbsp;SMALL MODEL. BIG MOVES.</span><h1>Can Jev play <em>chess?</em></h1></div>
        <p>Legal moves in. One choice out.<br />Let's see what happens.</p>
      </section>

      <section className="workspace">
        <div className="arena panel">
          <div className="arena-header"><span className="eyebrow"><i /> THE ARENA</span><div className="segmented"><button className="selected-button">You vs Jev</button><button disabled>Jev vs Jev</button></div></div>
          <div className="player-line"><PlayerBadge name="Jev 1.13" detail="BLACK PIECES" dark /></div>
          <div className="board-frame">
            <div className="board-labels ranks">{ranks.map((rank) => <span key={rank}>{rank}</span>)}</div>
            <div className="board">
              {squares().map((square, index) => {
                const piece = game.get(square);
                const isDark = (Math.floor(index / 8) + index) % 2 === 1;
                const isSelected = selected === square;
                const isTarget = legalTargets.has(square);
                const isLastMove = history.length > 0 && (() => {
                  const verbose = game.history({ verbose: true });
                  const last = verbose[verbose.length - 1];
                  return last?.from === square || last?.to === square;
                })();
                return <button key={square} className={`square ${isDark ? "dark" : "light"} ${isSelected ? "selected" : ""} ${isLastMove ? "last-move" : ""}`} onClick={() => void handleSquareClick(square)} aria-label={square}>
                  {piece && <span className={`piece ${piece.color === "w" ? "white-piece" : "black-piece"}`}>{pieceGlyphs[piece.color][piece.type]}</span>}
                  {isTarget && <span className={`move-marker ${piece ? "capture-marker" : ""}`} />}
                </button>;
              })}
            </div>
            <div className="board-labels files">{files.map((file) => <span key={file}>{file}</span>)}</div>
          </div>
          <div className="player-line bottom-player"><PlayerBadge name="You" detail="WHITE PIECES" /></div>
          <div className="arena-actions"><button className="pause-button" onClick={() => setError("Pause is visual for now—your game is safely saved locally.")}>Ⅱ&nbsp; Pause match</button><button className="icon-button" onClick={() => void startNewGame()} aria-label="New game">↻</button><button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Settings">♫</button></div>
          <p className="arena-note">A real API call on every turn. Pause at any time.</p>
        </div>

        <aside className="side-column">
          <section className="decision-card dark-card">
            <div className="card-heading"><span>INSIDE THE DECISION</span><span className="live-pill">{thinking ? "THINKING" : "LIVE RESULT"}</span></div>
            {insight ? <>
              <p className="decision-kicker">BLACK · {insight.model === "classifier.dev" ? "CLASSIFIER CHOSE" : "JEV CHOSE"}</p><h2>{insight.chosenSan}</h2>
              <p className="decision-detail">{insight.model === "classifier.dev" ? "classifier.dev selected a legal move." : "Jev selected the highest-probability legal move."}</p>
              {insight.candidates.length > 0 && <>
                <div className="choice-heading"><span>TOP CHOICES</span><span>PROBABILITY</span></div>
                <div className="probabilities">{insight.candidates.map((candidate) => <div className="probability-row" key={candidate.uci}><strong>{candidate.san}</strong><span><i style={{ width: `${Math.max(2, candidate.probability * 100)}%` }} /></span><b>{Math.round(candidate.probability * 100)}%</b></div>)}</div>
              </>}
              <div className="decision-metrics"><div><span>API ROUND TRIP</span><strong>{insight.latencyMs} <small>ms</small></strong></div><div><span>CONFIDENCE</span><strong>{insight.confidence === null ? "—" : <>{Math.round(insight.confidence * 100)}<small>%</small></>}</strong></div></div>
            </> : <div className="empty-decision"><span className="empty-star">✳</span><strong>{thinking ? "Jev is reading the position…" : "Make the first move."}</strong><p>{thinking ? "A structured choice is on its way back." : "Jev will rank every legal response after you move."}</p></div>}
          </section>

          <section className="small-card scene-card"><div className="small-card-heading"><h3>Set the scene</h3><span>⌄</span></div><button className="select-field" onClick={() => void startNewGame()}>Fresh board <span>⌄</span></button><p>The classic. Make the first move.</p><div className="scene-stats"><span>LEGAL ACTIONS <b>{game.moves().length}</b></span><span>{game.turn() === "w" ? "WHITE" : "BLACK"} TO MOVE</span></div></section>

          <section className="small-card reel-card"><div className="small-card-heading"><h3>The move reel</h3><button className="export-button">Export ↗</button></div><div className="move-list">{currentMoves.length ? currentMoves.slice(-4).map((row) => <div className="move-row" key={row.number}><span>{row.number}.</span><b>{row.white ?? "—"}</b><b>{row.black ?? "—"}</b></div>) : <p className="muted">Your moves will appear here.</p>}<div className="move-row reel-footer"><span>{history.length}</span><b>API calls</b><span>{insight ? `${insight.latencyMs} ms` : "—"}</span></div></div></section>

          <section className="small-card saved-card"><div className="small-card-heading"><h3>Saved locally</h3><span>{games.length}</span></div>{games.slice(0, 3).map((saved) => <div className={`saved-row ${saved.id === gameId ? "current" : ""}`} key={saved.id}><button onClick={() => restoreGame(saved)}><b>{saved.title}</b><small>{saved.status} · {new Date(saved.updatedAt).toLocaleDateString()}</small></button><button onClick={() => void removeGame(saved.id)} aria-label={`Delete ${saved.title}`}>×</button></div>)}{!games.length && <p className="muted">Games are stored in local SQLite.</p>}</section>
        </aside>
      </section>

      {error && <button className="error-toast" onClick={() => setError(null)}>{error}<span>×</span></button>}
      {!ready && <div className="loading">Opening local game lab…</div>}
      {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><section className="settings-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">✳ &nbsp;UNDER THE HOOD</span><h2>Choose your player</h2></div><button onClick={() => setShowSettings(false)}>×</button></div><p>{provider === "opencode" ? "Use your OpenCode Zen API key for Jev 1.13 Free. It is encrypted before being stored in this browser's local SQLite database." : "classifier.dev chooses the next legal move using Jev behind a simple classifier endpoint."}</p><div className="segmented" aria-label="Move provider"><button className={provider === "opencode" ? "selected-button" : ""} onClick={() => setProvider("opencode")}>OpenCode</button><button className={provider === "classifier" ? "selected-button" : ""} onClick={() => setProvider("classifier")}>classifier.dev</button></div>{provider === "opencode" && <label>OpenCode API key<input type="password" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} placeholder="sk-…" autoFocus /></label>}<div className="settings-actions"><button className="text-button" onClick={() => setShowSettings(false)}>Cancel</button><button className="pause-button compact" onClick={() => void saveSettings()}>Save player</button></div></section></div>}
    </main>
  );
}

function PlayerBadge({ name, detail, dark = false }: { name: string; detail: string; dark?: boolean }) {
  return <div className="player-badge"><span className={`player-icon ${dark ? "dark-icon" : ""}`}>i</span><div><strong>{name}</strong><small>{detail}</small></div><span className="turn-dot" /></div>;
}

export default App;
