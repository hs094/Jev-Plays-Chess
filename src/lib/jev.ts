import type { Move } from "chess.js";
import { moveToUci } from "./chess";

const JEV_ENDPOINT = "/api/jev";
const JEV_MODEL = "jev-1.13-free";

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
  confidence: number;
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
  apiKey: string,
  fen: string,
  pgn: string,
  legalMoves: Move[],
): Promise<JevInsight & { choice: string }> {
  const criteria = Object.fromEntries(
    legalMoves.map((move) => [
      moveToUci(move),
      `Play ${move.san} from ${move.from} to ${move.to}. Prefer sound chess development, king safety, and material.`
    ]),
  );

  const startedAt = performance.now();
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
