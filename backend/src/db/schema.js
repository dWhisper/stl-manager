import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './stl-manager.db';

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      size INTEGER,
      modified_at TEXT,
      thumbnail_path TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (file_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collection_files (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, file_id)
    );

    CREATE TABLE IF NOT EXISTS origins (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      url TEXT,
      external_name TEXT,
      external_author TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_origins_file ON origins(file_id);
    CREATE INDEX IF NOT EXISTS idx_file_tags_file ON file_tags(file_id);
    CREATE INDEX IF NOT EXISTS idx_collection_files_collection ON collection_files(collection_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_credentials (
      platform     TEXT PRIMARY KEY,
      username     TEXT NOT NULL,
      api_key      TEXT NOT NULL,
      profile_json TEXT,
      connected_at TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );
  `);

  // Additive column migrations — safe to run on existing DBs
  const cols = db.pragma('table_info(files)').map((c) => c.name);
  if (!cols.includes('zip_source')) db.exec(`ALTER TABLE files ADD COLUMN zip_source TEXT`);
  if (!cols.includes('zip_entry'))  db.exec(`ALTER TABLE files ADD COLUMN zip_entry TEXT`);
  if (!cols.includes('zip_source')) return;
  db.exec(`CREATE INDEX IF NOT EXISTS idx_files_zip_source ON files(zip_source)`);
}
