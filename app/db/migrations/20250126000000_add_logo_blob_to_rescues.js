/**
 * Migration: Add Logo Blob to Rescues
 * Created: 2025-01-26
 *
 * Adds logo_data (BLOB) and logo_mime (TEXT) columns to rescues table
 * to store logo images directly in the database instead of as file paths.
 */

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    // Add logo_data BLOB column for storing logo image data
    db.run(`ALTER TABLE rescues ADD COLUMN logo_data BLOB`);

    // Add logo_mime TEXT column for storing the MIME type
    db.run(`ALTER TABLE rescues ADD COLUMN logo_mime TEXT`);
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // SQLite doesn't support DROP COLUMN directly in older versions
    // We need to recreate the table without the columns
    db.run(`
        CREATE TABLE rescues_backup (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            website TEXT NOT NULL,
            logo_path TEXT NOT NULL,
            org_id TEXT,
            scraper_type TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    db.run(`
        INSERT INTO rescues_backup (id, name, website, logo_path, org_id, scraper_type, created_at)
        SELECT id, name, website, logo_path, org_id, scraper_type, created_at FROM rescues
    `);

    db.run(`DROP TABLE rescues`);
    db.run(`ALTER TABLE rescues_backup RENAME TO rescues`);
}

module.exports = { up, down };
