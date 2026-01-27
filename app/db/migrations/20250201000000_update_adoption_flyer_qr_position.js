/**
 * Migration: Update Adoption Flyer Layout and Font
 * Created: 2025-02-01
 *
 * This migration updates the adoption-flyer template:
 * - Move "Scan To Apply" and QR code to be centered underneath the animal photo
 * - Replace Luckiest Guy font with Arial for better legibility
 */

const fs = require('fs');
const path = require('path');

// Path to template files
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'cards');

/**
 * Read a template file from disk
 * @param {string} filename - Template filename
 * @returns {string} - Template contents
 */
function readTemplateFile(filename) {
    const filepath = path.join(TEMPLATES_DIR, filename);
    try {
        return fs.readFileSync(filepath, 'utf8');
    } catch (err) {
        console.error(`[Migration] Failed to read template file ${filename}:`, err.message);
        return null;
    }
}

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    // Read updated template HTML from file
    const adoptionFlyerHtml = readTemplateFile('adoption-flyer.html');

    if (!adoptionFlyerHtml) {
        console.error('[DB] Failed to read adoption-flyer template file, skipping');
        return;
    }

    const stmt = db.prepare(`
        UPDATE templates
        SET html_template = ?, updated_at = CURRENT_TIMESTAMP
        WHERE name = 'adoption-flyer' AND is_builtin = 1
    `);
    stmt.bind([adoptionFlyerHtml]);
    stmt.step();
    stmt.free();

    console.log('[DB] Updated adoption-flyer template: moved QR code under photo');
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // Note: down migration would require storing the old template HTML
    // For simplicity, we just log that this migration cannot be automatically reversed
    console.log('[DB] Migration 20250201000000 down: Manual intervention required to restore old template');
}

module.exports = { up, down };
