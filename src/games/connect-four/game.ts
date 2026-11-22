export const CONNECT_FOUR_ROWS = 6;
export const CONNECT_FOUR_COLUMNS = 7;

export type ConnectFourPlayer = "red" | "yellow";
export type ConnectFourCell = ConnectFourPlayer | null;

export type ConnectFourState = {
  board: ConnectFourCell[][];
  turn: ConnectFourPlayer;
  winner: ConnectFourPlayer | null;
  draw: boolean;
  moves: number[];
};

export function newConnectFourState(): ConnectFourState {
  return {
    board: Array.from({ length: CONNECT_FOUR_ROWS }, () => Array<ConnectFourCell>(CONNECT_FOUR_COLUMNS).fill(null)),
    turn: "red",
    winner: null,
    draw: false,
    moves: [],
  };
}

export function dropConnectFourPiece(state: ConnectFourState, column: number): ConnectFourState | null {
  if (state.winner || state.draw || column < 0 || column >= CONNECT_FOUR_COLUMNS) return null;
  const row = [...state.board].reverse().findIndex((cells) => cells[column] === null);
  if (row === -1) return null;

  const actualRow = CONNECT_FOUR_ROWS - 1 - row;
  const board = state.board.map((cells) => [...cells]);
  board[actualRow][column] = state.turn;
  const winner = hasConnectFourWinner(board, actualRow, column) ? state.turn : null;
  const draw = !winner && board.every((cells) => cells.every(Boolean));

  return {
    board,
    turn: state.turn === "red" ? "yellow" : "red",
    winner,
    draw,
    moves: [...state.moves, column],
  };
}

function hasConnectFourWinner(board: ConnectFourCell[][], row: number, column: number): boolean {
  const player = board[row][column];
  if (!player) return false;
  return [[0, 1], [1, 0], [1, 1], [1, -1]].some(([rowStep, columnStep]) =>
    countDirection(board, row, column, rowStep, columnStep, player) +
      countDirection(board, row, column, -rowStep, -columnStep, player) >= 3,
  );
}

function countDirection(
  board: ConnectFourCell[][],
  row: number,
  column: number,
  rowStep: number,
  columnStep: number,
  player: ConnectFourPlayer,
): number {
  let count = 0;
  for (let nextRow = row + rowStep, nextColumn = column + columnStep;
    nextRow >= 0 && nextRow < CONNECT_FOUR_ROWS && nextColumn >= 0 && nextColumn < CONNECT_FOUR_COLUMNS;
    nextRow += rowStep, nextColumn += columnStep) {
    if (board[nextRow][nextColumn] !== player) break;
    count += 1;
  }
  return count;
}

export function serializeConnectFourState(state: ConnectFourState): string {
  return JSON.stringify(state);
}

export function parseConnectFourState(value: string): ConnectFourState {
  const parsed = JSON.parse(value) as ConnectFourState;
  if (!Array.isArray(parsed.board) || parsed.board.length !== CONNECT_FOUR_ROWS) throw new Error("Invalid Connect Four save.");
  return parsed;
}
