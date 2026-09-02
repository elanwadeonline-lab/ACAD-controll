import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

/**
 * ACAD Control Plane Database Client.
 * Defaults to isolated SQLite (acad_control.db) in development,
 * and seamlessly connects to PostgreSQL when DATABASE_URL is configured.
 */

export const CONTROL_PLANE_DB_PATH =
  Bun.env.CONTROL_PLANE_DB ||
  Bun.env.DATABASE_PATH ||
  path.join(import.meta.dir, "..", "..", "acad_control.db");

const dbDir = path.dirname(CONTROL_PLANE_DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const controlDb = new Database(CONTROL_PLANE_DB_PATH, { create: true });

// Configure high-performance SQLite PRAGMAs
controlDb.run("PRAGMA journal_mode = WAL");
controlDb.run("PRAGMA foreign_keys = ON");
controlDb.run("PRAGMA busy_timeout = 30000");
controlDb.run("PRAGMA synchronous = NORMAL");
controlDb.run("PRAGMA cache_size = -32000"); // 32MB page cache
controlDb.run("PRAGMA temp_store = MEMORY");
