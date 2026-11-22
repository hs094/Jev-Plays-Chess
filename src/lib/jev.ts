import type { Move } from "chess.js";
import { moveToUci } from "../games/chess/game";
import type { ConnectFourState } from "../games/connect-four/game";
import type { DinoState, DinoAction } from "../games/dino/game";

const JEV_ENDPOINT = "/api/jev";
const JEV_MODEL = "jev-1.13-free";
const CLASSIFIER_ENDPOINT = "https://classifier.dev";

export type GameProvider = "opencode" | "classifier";

export type CandidateMove = {
  uci: string;
  san: string;
  from: string;
  to: string;
  probability: number;
};

export type JevInsight = {
  model: string;
  chosenSan: string;
  confidence: number | null;
  candidates: CandidateMove[];
  latencyMs: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

type JevResponse = {
  model?: string;
  answers?: {
    move?: {
      type?: string;
      choice?: string;
      confidence?: number;
      probabilities?: Record<string, number>;
    };
  };
  usage?: JevInsight["usage"];
};

export async function chooseMove(
  provider: GameProvider,
  apiKey: string | null,
  fen: string,
  pgn: string,
  legalMoves: Move[],
): Promise<JevInsight & { choice: string }> {
  const startedAt = performance.now();
  if (provider === "classifier") {
    return chooseClassifierMove(fen, pgn, legalMoves, startedAt);
  }
  if (!apiKey) throw new Error("An OpenCode API key is required.");

  const criteria = Object.fromEntries(
    legalMoves.map((move) => [
      moveToUci(move),
      `Play ${move.san} from ${move.from} to ${move.to}. Prefer sound chess development, king safety, and material.`
    ]),
  );

  const response = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: {
        game: "chess",
        side_to_move: "black",
        fen,
        pgn,
        legal_moves: legalMoves.map((move) => ({
          uci: moveToUci(move),
          san: move.san,
          from: move.from,
          to: move.to,
        })),
      },
      questions: {
        move: {
          type: "choice",
          instructions: "Which legal move should Jev play? Choose exactly one move. Evaluate the current chess position, not just the move descriptions.",
          criteria,
        },
      },
    }),
  });

  const body = (await response.json()) as JevResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Jev request failed (${response.status})`);
  }

  const answer = body.answers?.move;
  if (!answer?.choice || !criteria[answer.choice]) {
    throw new Error("Jev returned an invalid chess move.");
  }

  const probabilities = answer.probabilities ?? {};
  const candidates = legalMoves
    .map((move) => {
      const uci = moveToUci(move);
      return {
        uci,
        san: move.san,
        from: move.from,
        to: move.to,
        probability: probabilities[uci] ?? 0,
      };
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5);

  return {
    choice: answer.choice,
    chosenSan: legalMoves.find((move) => moveToUci(move) === answer.choice)?.san ?? answer.choice,
    model: body.model ?? JEV_MODEL,
    confidence: answer.confidence ?? 0,
    candidates,
    latencyMs: Math.round(performance.now() - startedAt),
    usage: body.usage,
  };
}

export async function chooseDinoMove(
  provider: GameProvider,
  apiKey: string | null,
  state: DinoState,
): Promise<JevInsight & { choice: DinoAction }> {
  const startedAt = performance.now();
  const labels: DinoAction[] = ["jump", "wait"];
  let choice: DinoAction;
  let model = "classifier.dev";
  let confidence: number | null = null;
  let usage: JevInsight["usage"];

  if (provider === "classifier") {
    const prompt = [
      "You are playing Chrome Dino.",
      `Score: ${state.score}. Speed: ${state.speed.toFixed(1)}. Dino height: ${state.dinoY.toFixed(1)}.`,
      `The next cactus is ${Math.max(0, Math.round(state.obstacle.x - 88))} pixels away and ${Math.round(state.obstacle.height)} pixels tall.`,
      "Choose jump if the dino should jump now, otherwise choose wait.",
      "Return exactly one action: jump or wait.",
    ].join(" ");
    const response = await fetch(`${CLASSIFIER_ENDPOINT}/${labels.join(",")}/${encodeURIComponent(prompt)}`);
    const result = (await response.text()).trim() as DinoAction;
    if (!response.ok) throw new Error(`classifier.dev request failed (${response.status})`);
    if (!labels.includes(result)) throw new Error("classifier.dev returned an invalid Dino action.");
    choice = result;
  } else {
    if (!apiKey) throw new Error("An OpenCode API key is required.");
    const criteria = {
      jump: "Jump over the approaching cactus now.",
      wait: "Keep running and do not jump yet.",
    };
    const response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: {
          game: "dino",
          side_to_move: "jev",
          score: state.score,
          speed: state.speed,
          dino_height: state.dinoY,
          obstacle_distance: Math.max(0, state.obstacle.x - 88),
          obstacle_height: state.obstacle.height,
        },
        questions: { move: { type: "choice", instructions: "Choose exactly one action to keep the Dino alive.", criteria } },
      }),
    });
    const body = (await response.json()) as JevResponse & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Jev request failed (${response.status})`);
    const answer = body.answers?.move;
    if (!answer?.choice || !labels.includes(answer.choice as DinoAction)) throw new Error("Jev returned an invalid Dino action.");
    choice = answer.choice as DinoAction;
    model = body.model ?? JEV_MODEL;
    confidence = answer.confidence ?? 0;
    usage = body.usage;
  }

  return {
    choice,
    chosenSan: choice === "jump" ? "Jump" : "Wait",
    model,
    confidence,
    candidates: [],
    latencyMs: Math.round(performance.now() - startedAt),
    usage,
  };
}

export async function chooseConnectFourMove(
  provider: GameProvider,
  apiKey: string | null,
  state: ConnectFourState,
  legalColumns: number[],
): Promise<JevInsight & { choice: number }> {
  const startedAt = performance.now();
  const labels = legalColumns.map(String);
  let choice: string;
  let model = "classifier.dev";
  let confidence: number | null = null;
  let candidates: CandidateMove[] = [];
  let usage: JevInsight["usage"];

  if (provider === "classifier") {
    const prompt = [
      "You are playing yellow in Connect Four.",
      `Board rows top to bottom: ${JSON.stringify(state.board)}`,
      `Choose the strongest available column from: ${labels.join(", ")}`,
      "Return exactly one column number and nothing else.",
    ].join(" ");
    const response = await fetch(`${CLASSIFIER_ENDPOINT}/${labels.join(",")}/${encodeURIComponent(prompt)}`);
    choice = (await response.text()).trim();
    if (!response.ok) throw new Error(`classifier.dev request failed (${response.status})`);
    if (!labels.includes(choice)) throw new Error("classifier.dev returned an invalid Connect Four column.");
  } else {
    if (!apiKey) throw new Error("An OpenCode API key is required.");
    const criteria = Object.fromEntries(legalColumns.map((column) => [String(column), `Drop a piece in column ${column + 1}.`]))
    const response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: { game: "connect-four", side_to_move: "yellow", board: state.board, moves: state.moves, legal_columns: legalColumns },
        questions: { move: { type: "choice", instructions: "Which legal column should Jev choose? Evaluate the board and choose exactly one.", criteria } },
      }),
    });
    const body = (await response.json()) as JevResponse & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Jev request failed (${response.status})`);
    const answer = body.answers?.move;
    if (!answer?.choice || !criteria[answer.choice]) throw new Error("Jev returned an invalid Connect Four column.");
    choice = answer.choice;
    model = body.model ?? JEV_MODEL;
    confidence = answer.confidence ?? 0;
    usage = body.usage;
    candidates = legalColumns.map((column) => ({
      uci: String(column), san: `Column ${column + 1}`, from: "", to: "", probability: answer.probabilities?.[String(column)] ?? 0,
    })).sort((a, b) => b.probability - a.probability).slice(0, 5);
  }

  return {
    choice: Number(choice),
    chosenSan: `Column ${Number(choice) + 1}`,
    model,
    confidence,
    candidates,
    latencyMs: Math.round(performance.now() - startedAt),
    usage,
  };
}

async function chooseClassifierMove(
  fen: string,
  pgn: string,
  legalMoves: Move[],
  startedAt: number,
): Promise<JevInsight & { choice: string }> {
  const labels = legalMoves.map(moveToUci);
  const prompt = [
    "You are playing black in a chess game.",
    `FEN: ${fen}`,
    pgn ? `PGN: ${pgn}` : "",
    `Choose the strongest move from these legal UCI moves: ${labels.join(", ")}`,
    "Return exactly one UCI move and nothing else.",
  ].filter(Boolean).join(" ");
  const response = await fetch(`${CLASSIFIER_ENDPOINT}/${labels.join(",")}/${encodeURIComponent(prompt)}`);
  const choice = (await response.text()).trim();
  if (!response.ok) {
    throw new Error(`classifier.dev request failed (${response.status})`);
  }
  if (!labels.includes(choice)) {
    throw new Error("classifier.dev returned an invalid chess move.");
  }

  return {
    choice,
    chosenSan: legalMoves.find((move) => moveToUci(move) === choice)?.san ?? choice,
    model: "classifier.dev",
    confidence: null,
    candidates: [],
    latencyMs: Math.round(performance.now() - startedAt),
  };
}
