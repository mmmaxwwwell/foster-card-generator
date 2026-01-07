-- Schema for foster card generator database
-- Run with: sqlite3 db/animals.db < db/schema.sql

CREATE TABLE IF NOT EXISTS animals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    size TEXT NOT NULL,
    shots INTEGER NOT NULL DEFAULT 0,
    housetrained INTEGER NOT NULL DEFAULT 0,
    breed TEXT NOT NULL,
    age_long TEXT NOT NULL,
    age_short TEXT NOT NULL,
    gender TEXT NOT NULL,
    kids TEXT NOT NULL DEFAULT '?',
    dogs TEXT NOT NULL DEFAULT '?',
    cats TEXT NOT NULL DEFAULT '?',
    portrait_path TEXT,
    portrait_data BLOB,
    portrait_mime TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for faster lookups by name
CREATE INDEX IF NOT EXISTS idx_animals_name ON animals(name);

-- Trigger to update updated_at on row changes
CREATE TRIGGER IF NOT EXISTS update_animals_timestamp
AFTER UPDATE ON animals
BEGIN
    UPDATE animals SET updated_at = datetime('now') WHERE id = NEW.id;
END;
