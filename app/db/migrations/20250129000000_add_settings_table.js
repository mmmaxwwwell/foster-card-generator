/**
 * Migration: Add Settings Table
 * Created: 2025-01-29
 *
 * Creates a key-value settings table for storing app configuration
 * such as API keys and other user preferences.
 */

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    // Create settings table for key-value storage
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Create trigger for settings updated_at
    db.run(`
        CREATE TRIGGER IF NOT EXISTS update_settings_timestamp
        AFTER UPDATE ON settings
        BEGIN
            UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key;
        END
    `);

    console.log('[DB] Created settings table');
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    db.run('DROP TRIGGER IF EXISTS update_settings_timestamp');
    db.run('DROP TABLE IF EXISTS settings');
    console.log('[DB] Dropped settings table');
}

module.exports = { up, down };
