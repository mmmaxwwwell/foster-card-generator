/**
 * Migration: Add photo_urls column to animals table
 * Created: 2025-02-02
 *
 * Adds a photo_urls TEXT column to store a JSON array of all available photo URLs
 * from the adoption website. This allows users to pick from multiple photos.
 */

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    db.run(`ALTER TABLE animals ADD COLUMN photo_urls TEXT DEFAULT '[]'`);
    console.log('[DB Migration] Added photo_urls column to animals table');
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // SQLite doesn't support DROP COLUMN directly in older versions
    // We need to recreate the table without the photo_urls column
    db.run(`
        CREATE TABLE animals_backup AS
        SELECT id, name, slug, size, shots, housetrained, breed, age_long, age_short,
               gender, kids, dogs, cats, portrait_path, portrait_data, portrait_mime,
               rescue_id, bio, attributes, created_at, updated_at
        FROM animals
    `);
    db.run(`DROP TABLE animals`);
    db.run(`ALTER TABLE animals_backup RENAME TO animals`);
    console.log('[DB Migration] Removed photo_urls column from animals table');
}

module.exports = { up, down };
