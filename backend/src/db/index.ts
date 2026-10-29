import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH || './data/terminalsql.db';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}

export async function initDatabase() {
  // Ensure data directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);

  // Performance pragmas
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');

  _db = drizzle(sqlite, { schema });

  // Create tables if not exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_login INTEGER
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ssh', 'database', 'sftp')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      encrypted_credentials TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#00d4ff',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used INTEGER
    );

    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
      query TEXT NOT NULL,
      duration_ms INTEGER,
      row_count INTEGER,
      status TEXT NOT NULL DEFAULT 'success',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sql_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      query TEXT NOT NULL,
      db_type TEXT NOT NULL DEFAULT 'all',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id);
    CREATE INDEX IF NOT EXISTS idx_query_history_user ON query_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_sql_templates_user ON sql_templates(user_id);
  `);

  try {
    sqlite.exec(`ALTER TABLE connections ADD COLUMN folder TEXT;`);
  } catch {}

  // Prune old records at startup to keep SQLite file size bounded:
  // - query_history: keep newest 1000 rows per user
  // - audit_logs: delete records older than 90 days
  try {
    sqlite.exec(`
      DELETE FROM query_history
      WHERE id NOT IN (
        SELECT id FROM query_history
        ORDER BY created_at DESC
        LIMIT 1000
      );
      DELETE FROM audit_logs
      WHERE created_at < (unixepoch() - 90 * 86400);
    `);
  } catch {}

  console.log('✅ Database initialized at', DB_PATH);
}
