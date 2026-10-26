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

  db.exec(`
    -- Items bought or downloaded on a platform, refreshed by a sync
    CREATE TABLE IF NOT EXISTS purchases (
      platform      TEXT NOT NULL,
      external_id   TEXT NOT NULL,
      name          TEXT NOT NULL,
      creator       TEXT,
      url           TEXT,
      download_url  TEXT,
      thumbnail_url TEXT,
      file_names    TEXT,               -- JSON array of the item's file names
      purchased_at  TEXT,
      ignored       INTEGER NOT NULL DEFAULT 0,
      synced_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (platform, external_id)
    );

    CREATE TABLE IF NOT EXISTS platform_sync (
      platform  TEXT PRIMARY KEY,
      synced_at TEXT,
      total     INTEGER,
      error     TEXT
    );

    -- Links from a library folder or model (its path in the library index) to
    -- where it came from. external_id is set when the link is to a synced purchase.
    CREATE TABLE IF NOT EXISTS model_links (
      id              TEXT PRIMARY KEY,
      model_path      TEXT NOT NULL,
      source          TEXT NOT NULL,
      external_id     TEXT,
      url             TEXT,
      external_name   TEXT,
      external_author TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_model_links_path ON model_links(model_path);
    CREATE INDEX IF NOT EXISTS idx_model_links_external ON model_links(source, external_id);

    -- Suggested matches the user said were wrong, so they aren't suggested again
    CREATE TABLE IF NOT EXISTS match_rejections (
      platform    TEXT NOT NULL,
      external_id TEXT NOT NULL,
      model_path  TEXT NOT NULL,
      PRIMARY KEY (platform, external_id, model_path)
    );
  `);

  // Additive column migrations — safe to run on existing DBs
  const cols = db.pragma('table_info(files)').map((c) => c.name);
  if (!cols.includes('zip_source')) db.exec(`ALTER TABLE files ADD COLUMN zip_source TEXT`);
  if (!cols.includes('zip_entry'))  db.exec(`ALTER TABLE files ADD COLUMN zip_entry TEXT`);
  // Why the last thumbnail attempt failed; set means "don't retry until the file changes"
  if (!cols.includes('thumb_error')) db.exec(`ALTER TABLE files ADD COLUMN thumb_error TEXT`);
  const purchaseCols = db.pragma('table_info(purchases)').map((c) => c.name);
  // Where in the platform's library an item came from (an MMF tribe, campaign...)
  if (!purchaseCols.includes('source')) db.exec(`ALTER TABLE purchases ADD COLUMN source TEXT`);
  // The MMF tribe (and tier) an item was released to, from objectPreviews
  if (!purchaseCols.includes('tribe_id')) db.exec(`ALTER TABLE purchases ADD COLUMN tribe_id INTEGER`);
  if (!purchaseCols.includes('tier_id')) db.exec(`ALTER TABLE purchases ADD COLUMN tier_id INTEGER`);
  if (!cols.includes('zip_source')) return;
  db.exec(`CREATE INDEX IF NOT EXISTS idx_files_zip_source ON files(zip_source)`);
}
