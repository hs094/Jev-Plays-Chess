export const DINO_TRACK_WIDTH = 720;
export const DINO_GROUND = 0;

export type DinoAction = "jump" | "wait";

export type DinoState = {
  score: number;
  speed: number;
  dinoY: number;
  velocity: number;
  obstacle: {
    x: number;
    width: number;
    height: number;
  };
  queuedAction: DinoAction | null;
  decisionPending: boolean;
  gameOver: boolean;
};

export function newDinoState(): DinoState {
  return {
    score: 0,
    speed: 6,
    dinoY: DINO_GROUND,
    velocity: 0,
    obstacle: { x: DINO_TRACK_WIDTH + 80, width: 24, height: 38 },
    queuedAction: null,
    decisionPending: false,
    gameOver: false,
  };
}

export function tickDino(state: DinoState): DinoState {
  if (state.gameOver) return state;

  const action = state.queuedAction ?? "wait";
  const velocity = state.dinoY === DINO_GROUND && action === "jump" ? 16 : state.velocity - 1.15;
  const dinoY = Math.max(DINO_GROUND, state.dinoY + velocity);
  let obstacle = { ...state.obstacle, x: state.obstacle.x - state.speed };
  let score = state.score;

  if (obstacle.x + obstacle.width < 0) {
    score += 1;
    obstacle = {
      x: DINO_TRACK_WIDTH + 90 + Math.random() * 170,
      width: 20 + Math.random() * 18,
      height: 28 + Math.random() * 24,
    };
  }

  const dinoLeft = 54;
  const dinoRight = dinoLeft + 34;
  const hitsObstacle = obstacle.x < dinoRight && obstacle.x + obstacle.width > dinoLeft && dinoY < obstacle.height;

  return {
    ...state,
    score,
    speed: Math.min(10, 6 + score * 0.15),
    dinoY,
    velocity: dinoY === DINO_GROUND ? 0 : velocity,
    obstacle,
    queuedAction: null,
    gameOver: hitsObstacle,
  };
}

export function serializeDinoState(state: DinoState): string {
  return JSON.stringify(state);
}

export function parseDinoState(value: string): DinoState {
  const parsed = JSON.parse(value) as DinoState;
  if (!parsed.obstacle || typeof parsed.score !== "number") throw new Error("Invalid Dino save.");
  return parsed;
}
