-- Schema for foster card generator database
-- Run with: sqlite3 db/animals.db < db/schema.sql

-- Rescues table to store organization information
CREATE TABLE IF NOT EXISTS rescues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    website TEXT NOT NULL,
    logo_path TEXT NOT NULL,
    org_id TEXT,
    scraper_type TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Insert default rescues (logo_path is relative to src/ directory)
INSERT OR IGNORE INTO rescues (id, name, website, logo_path, org_id, scraper_type) VALUES
    (1, 'Paws Rescue League', 'pawsrescueleague.org', 'logo.png', '1841035', 'wagtopia'),
    (2, 'Brass City Rescue', 'brasscityrescuealliance.org', 'brass-city-logo.jpg', '87063', 'adoptapet');

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
    rescue_id INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (rescue_id) REFERENCES rescues(id)
);

-- Index for faster lookups by name
CREATE INDEX IF NOT EXISTS idx_animals_name ON animals(name);

-- Index for faster lookups by rescue
CREATE INDEX IF NOT EXISTS idx_animals_rescue ON animals(rescue_id);

-- Trigger to update updated_at on row changes
CREATE TRIGGER IF NOT EXISTS update_animals_timestamp
AFTER UPDATE ON animals
BEGIN
    UPDATE animals SET updated_at = datetime('now') WHERE id = NEW.id;
END;
