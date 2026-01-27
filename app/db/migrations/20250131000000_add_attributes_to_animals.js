/**
 * Migration: Add attributes column to animals table
 * Created: 2025-01-31
 *
 * Adds an attributes TEXT column to store a JSON array of custom attributes
 * for the adoption flyer template (max 16 attributes).
 */

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    db.run(`ALTER TABLE animals ADD COLUMN attributes TEXT DEFAULT '[]'`);
    console.log('[DB Migration] Added attributes column to animals table');
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // SQLite doesn't support DROP COLUMN directly in older versions
    // We need to recreate the table without the attributes column
    db.run(`
        CREATE TABLE animals_backup AS
        SELECT id, name, slug, size, shots, housetrained, breed, age_long, age_short,
               gender, kids, dogs, cats, portrait_path, portrait_data, portrait_mime,
               rescue_id, bio, created_at, updated_at
        FROM animals
    `);
    db.run(`DROP TABLE animals`);
    db.run(`ALTER TABLE animals_backup RENAME TO animals`);
    console.log('[DB Migration] Removed attributes column from animals table');
}

module.exports = { up, down };
