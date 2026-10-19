/**
 * Persistence layer built on node:sqlite (bundled with Node >= 22.5).
 * No native compilation, no external database server -> trivial to Dockerize.
 * The database file lives in DATA_DIR so it survives container restarts.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import config from './config.js';

const dbPath = config.dbFile
  ? resolve(config.dbFile)
  : join(resolve(config.dataDir), 'fitforge.db');

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

// Node 20/22/23 gate node:sqlite behind an experimental warning.
// It is a supported API and the warning is pure noise in container logs.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w?.name === 'ExperimentalWarning' && /sqlite/i.test(w.message)) return;
  console.warn(w);
});

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  google_id     TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sex            TEXT DEFAULT 'male',
  birth_date     TEXT,
  height_cm      REAL,
  weight_kg      REAL,
  body_fat_pct   REAL,
  target_weight_kg REAL,
  activity_level TEXT DEFAULT 'moderate',
  goal           TEXT DEFAULT 'recomp',
  experience     TEXT DEFAULT 'intermediate',
  days_per_week  INTEGER DEFAULT 4,
  session_minutes INTEGER DEFAULT 60,
  equipment      TEXT DEFAULT 'full_gym',
  injuries       TEXT DEFAULT '',
  diet_pref      TEXT DEFAULT 'omnivore',
  allergies      TEXT DEFAULT '',
  focus_areas    TEXT DEFAULT '',
  sleep_hours    REAL DEFAULT 7,
  notes          TEXT DEFAULT '',
  timezone       TEXT DEFAULT 'UTC',
  units          TEXT DEFAULT 'metric',
  favorite_exercises TEXT DEFAULT '[]',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  weight_kg  REAL,
  body_fat_pct REAL,
  waist_cm   REAL,
  notes      TEXT DEFAULT '',
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS workout_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Workout',
  focus      TEXT DEFAULT 'full_body',
  duration_s INTEGER DEFAULT 0,
  calories   INTEGER DEFAULT 0,
  rpe        REAL,
  notes      TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON workout_logs(user_id, date);

CREATE TABLE IF NOT EXISTS sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id        INTEGER NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          TEXT NOT NULL DEFAULT '',
  exercise_id   TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  set_number    INTEGER NOT NULL DEFAULT 1,
  reps          INTEGER NOT NULL DEFAULT 0,
  weight_kg     REAL NOT NULL DEFAULT 0,
  rpe           REAL,
  tempo         TEXT DEFAULT '',
  rest_s        INTEGER DEFAULT 90,
  is_warmup     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sets_user ON sets(user_id, exercise_id);
CREATE INDEX IF NOT EXISTS idx_sets_user_date ON sets(user_id, date);

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  meal_type  TEXT NOT NULL DEFAULT 'snack',
  food_name  TEXT NOT NULL,
  grams      REAL DEFAULT 0,
  calories   REAL DEFAULT 0,
  protein_g  REAL DEFAULT 0,
  carbs_g    REAL DEFAULT 0,
  fat_g      REAL DEFAULT 0,
  source     TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nutrition_user_date ON nutrition_logs(user_id, date);

CREATE TABLE IF NOT EXISTS ai_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT 'Plan',
  payload     TEXT NOT NULL DEFAULT '{}',
  model       TEXT DEFAULT '',
  source      TEXT DEFAULT 'ai',
  tokens      INTEGER DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plans_user ON ai_plans(user_id, kind, created_at);

CREATE TABLE IF NOT EXISTS ai_cache (
  key         TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  model       TEXT DEFAULT '',
  payload     TEXT NOT NULL,
  tokens      INTEGER DEFAULT 0,
  hits        INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER,
  ts               TEXT NOT NULL DEFAULT (datetime('now')),
  day              TEXT NOT NULL,
  endpoint         TEXT DEFAULT '',
  model            TEXT DEFAULT '',
  prompt_tokens    INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens     INTEGER DEFAULT 0,
  status           TEXT DEFAULT 'ok',
  cached           INTEGER DEFAULT 0,
  latency_ms       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON ai_usage(day);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL DEFAULT 'default',
  role       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  tokens     INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, created_at);

CREATE TABLE IF NOT EXISTS saved_meals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  items      TEXT NOT NULL DEFAULT '[]',
  calories   REAL DEFAULT 0,
  protein_g  REAL DEFAULT 0,
  carbs_g    REAL DEFAULT 0,
  fat_g      REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_meals_user ON saved_meals(user_id);

CREATE TABLE IF NOT EXISTS custom_foods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  brand      TEXT DEFAULT '',
  category   TEXT DEFAULT 'custom',
  serving_g  REAL NOT NULL DEFAULT 100,
  kcal       REAL NOT NULL DEFAULT 0,
  protein_g  REAL NOT NULL DEFAULT 0,
  carbs_g    REAL NOT NULL DEFAULT 0,
  fat_g      REAL NOT NULL DEFAULT 0,
  source     TEXT DEFAULT 'custom',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_foods_user ON custom_foods(user_id);

CREATE TABLE IF NOT EXISTS custom_exercises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  category     TEXT DEFAULT 'isolation',
  equipment    TEXT DEFAULT 'dumbbell',
  muscles      TEXT NOT NULL DEFAULT '[]',
  pattern      TEXT DEFAULT 'accessory',
  instructions TEXT DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_exercises_user ON custom_exercises(user_id);

CREATE TABLE IF NOT EXISTS external_food_cache (
  query_key   TEXT PRIMARY KEY,
  data_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ext_food_cache_time ON external_food_cache(created_at);
`;

db.exec(SCHEMA);

// Additive migration for databases created before session invalidation or Google identity existed.
// SQLite has no portable ADD COLUMN IF NOT EXISTS form on all supported versions.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('session_version')) {
  db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1');
}
if (!userColumns.includes('google_id')) {
  db.exec('ALTER TABLE users ADD COLUMN google_id TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');

const profileColumns = db.prepare('PRAGMA table_info(profiles)').all().map((c) => c.name);
if (!profileColumns.includes('timezone')) {
  db.exec("ALTER TABLE profiles ADD COLUMN timezone TEXT DEFAULT 'UTC'");
}
if (!profileColumns.includes('units')) {
  db.exec("ALTER TABLE profiles ADD COLUMN units TEXT DEFAULT 'metric'");
}
if (!profileColumns.includes('favorite_exercises')) {
  db.exec("ALTER TABLE profiles ADD COLUMN favorite_exercises TEXT DEFAULT '[]'");
}

/* ------------------------------ helpers --------------------------------- */

export function run(sql, ...params) {
  const info = db.prepare(sql).run(...params);
  return {
    changes: Number(info.changes ?? 0),
    lastInsertRowid: Number(info.lastInsertRowid ?? 0),
  };
}

/**
 * node:sqlite returns null-prototype row objects. They serialise to JSON fine,
 * but `{...row}` keeps the null prototype and `row instanceof Object` is false,
 * which silently breaks downstream merging. Normalise once, here.
 */
const plain = (row) => (row ? Object.assign({}, row) : row);

export function get(sql, ...params) {
  return plain(db.prepare(sql).get(...params) ?? null);
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params).map((r) => Object.assign({}, r));
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

/** today in YYYY-MM-DD, local to the server */
export function today() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export const dbInfo = { path: dbPath };
