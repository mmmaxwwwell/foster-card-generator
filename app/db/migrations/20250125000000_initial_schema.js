/**
 * Migration: Initial Schema
 * Created: 2025-01-25
 *
 * This migration captures the initial database schema for foster-card-generator.
 * It creates the rescues, animals, and print_profiles tables with all their
 * columns, indexes, and triggers.
 */

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    // Create rescues table
    db.run(`
        CREATE TABLE IF NOT EXISTS rescues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            website TEXT NOT NULL,
            logo_path TEXT NOT NULL,
            org_id TEXT,
            scraper_type TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Create animals table
    db.run(`
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
        )
    `);

    // Create indexes for animals table
    db.run(`CREATE INDEX IF NOT EXISTS idx_animals_name ON animals(name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_animals_rescue ON animals(rescue_id)`);

    // Create trigger for animals updated_at
    db.run(`
        CREATE TRIGGER IF NOT EXISTS update_animals_timestamp
        AFTER UPDATE ON animals
        BEGIN
            UPDATE animals SET updated_at = datetime('now') WHERE id = NEW.id;
        END
    `);

    // Create print_profiles table
    db.run(`
        CREATE TABLE IF NOT EXISTS print_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            printer_name TEXT NOT NULL,
            copies INTEGER NOT NULL DEFAULT 1,
            paper_size TEXT NOT NULL DEFAULT 'letter',
            orientation TEXT NOT NULL DEFAULT 'landscape',
            paper_source TEXT NOT NULL DEFAULT 'default',
            is_default INTEGER NOT NULL DEFAULT 0,
            calibration_ab REAL,
            calibration_bc REAL,
            calibration_cd REAL,
            calibration_da REAL,
            border_top REAL,
            border_right REAL,
            border_bottom REAL,
            border_left REAL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Create index for print_profiles
    db.run(`CREATE INDEX IF NOT EXISTS idx_print_profiles_printer ON print_profiles(printer_name)`);

    // Create trigger for print_profiles updated_at
    db.run(`
        CREATE TRIGGER IF NOT EXISTS update_print_profiles_timestamp
        AFTER UPDATE ON print_profiles
        BEGIN
            UPDATE print_profiles SET updated_at = datetime('now') WHERE id = NEW.id;
        END
    `);
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // Drop triggers first
    db.run('DROP TRIGGER IF EXISTS update_print_profiles_timestamp');
    db.run('DROP TRIGGER IF EXISTS update_animals_timestamp');

    // Drop indexes
    db.run('DROP INDEX IF EXISTS idx_print_profiles_printer');
    db.run('DROP INDEX IF EXISTS idx_animals_rescue');
    db.run('DROP INDEX IF EXISTS idx_animals_name');

    // Drop tables in reverse dependency order
    db.run('DROP TABLE IF EXISTS print_profiles');
    db.run('DROP TABLE IF EXISTS animals');
    db.run('DROP TABLE IF EXISTS rescues');
}

module.exports = { up, down };
