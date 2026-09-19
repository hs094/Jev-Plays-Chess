import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { GameProvider, JevInsight } from "./jev";

const SQLITE_BLOB_KEY = "database";
const CRYPTO_KEY_ID = "api-key-encryption";
const PROVIDER_KEY = "provider";

export type GameRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  fen: string;
  pgn: string;
  playerColor: "w" | "b";
  status: string;
  insight: JevInsight | null;
};

let database: Database | null = null;
let databasePromise: Promise<Database> | null = null;
let encryptionKeyPromise: Promise<CryptoKey> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openStore(name: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDatabaseBlob(): Promise<Uint8Array | null> {
  const store = await openStore("jev-chess-sqlite", "sqlite");
  const transaction = store.transaction("sqlite", "readonly");
  const value = await requestResult(transaction.objectStore("sqlite").get(SQLITE_BLOB_KEY));
  store.close();
  return value ? new Uint8Array(value as ArrayBuffer) : null;
}

async function persistDatabase(): Promise<void> {
  if (!database) return;
  const store = await openStore("jev-chess-sqlite", "sqlite");
  const transaction = store.transaction("sqlite", "readwrite");
  transaction.objectStore("sqlite").put(database.export().buffer, SQLITE_BLOB_KEY);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  store.close();
}

async function openDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const blob = await readDatabaseBlob();
  database = blob ? new SQL.Database(blob) : new SQL.Database();
  database.run(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      fen TEXT NOT NULL,
      pgn TEXT NOT NULL,
      player_color TEXT NOT NULL,
      status TEXT NOT NULL,
      insight_json TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await persistDatabase();
  return database;
}

export function getDatabase(): Promise<Database> {
  if (database) return Promise.resolve(database);
  databasePromise ??= openDatabase().catch((reason: unknown) => {
    databasePromise = null;
    throw reason;
  });
  return databasePromise;
}

export async function saveGame(game: GameRecord): Promise<void> {
  const db = await getDatabase();
  db.run(
    `INSERT OR REPLACE INTO games
      (id, title, created_at, updated_at, fen, pgn, player_color, status, insight_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      game.id,
      game.title,
      game.createdAt,
      game.updatedAt,
      game.fen,
      game.pgn,
      game.playerColor,
      game.status,
      game.insight ? JSON.stringify(game.insight) : null,
    ],
  );
  await persistDatabase();
}

export async function listGames(): Promise<GameRecord[]> {
  const db = await getDatabase();
  const result = db.exec("SELECT * FROM games ORDER BY updated_at DESC");
  if (!result[0]) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const record = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    return {
      id: String(record.id),
      title: String(record.title),
      createdAt: Number(record.created_at),
      updatedAt: Number(record.updated_at),
      fen: String(record.fen),
      pgn: String(record.pgn),
      playerColor: record.player_color as "w" | "b",
      status: String(record.status),
      insight: record.insight_json ? JSON.parse(String(record.insight_json)) as JevInsight : null,
    };
  });
}

export async function deleteGame(id: string): Promise<void> {
  const db = await getDatabase();
  db.run("DELETE FROM games WHERE id = ?", [id]);
  await persistDatabase();
}

async function createOrLoadEncryptionKey(): Promise<CryptoKey> {
  const store = await openStore("jev-chess-crypto", "keys");
  const existing = await requestResult(store.transaction("keys", "readonly").objectStore("keys").get(CRYPTO_KEY_ID));
  store.close();
  if (existing) return existing as CryptoKey;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const writeStore = await openStore("jev-chess-crypto", "keys");
  const transaction = writeStore.transaction("keys", "readwrite");
  transaction.objectStore("keys").put(key, CRYPTO_KEY_ID);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  writeStore.close();
  return key;
}

function getEncryptionKey(): Promise<CryptoKey> {
  encryptionKeyPromise ??= createOrLoadEncryptionKey();
  return encryptionKeyPromise;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function saveProvider(provider: GameProvider): Promise<void> {
  const db = await getDatabase();
  db.run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [PROVIDER_KEY, provider],
  );
  await persistDatabase();
}

export async function loadProvider(): Promise<GameProvider> {
  const db = await getDatabase();
  const result = db.exec("SELECT value FROM settings WHERE key = 'provider'");
  return result[0]?.values[0]?.[0] === "classifier" ? "classifier" : "opencode";
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const db = await getDatabase();
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(apiKey),
  );
  db.run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["jev_api_key", JSON.stringify({ iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) })],
  );
  await persistDatabase();
}

export async function loadApiKey(): Promise<string | null> {
  const db = await getDatabase();
  const result = db.exec("SELECT value FROM settings WHERE key = 'jev_api_key'");
  if (!result[0]?.values[0]?.[0]) return null;

  const encrypted = JSON.parse(String(result[0].values[0][0])) as { iv: string; ciphertext: string };
  const iv = fromBase64(encrypted.iv);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    await getEncryptionKey(),
    ciphertext.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(plaintext);
}
