/**
 * Migration: Add Adoption Flyer Template
 * Created: 2025-01-28
 *
 * This migration adds the adoption-flyer template, a full-page 8.5x11 portrait
 * flyer featuring a large animal photo, traits list, QR code, and rescue branding.
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

// Adoption flyer configuration
const ADOPTION_FLYER_CONFIG = {
    pageWidthInches: 8.5,
    pageHeightInches: 11,
    orientation: 'portrait',
    paperSize: 'letter',
    dpi: 360,
    preprocessing: {
        generateQrCode: true,
        qrCodeField: 'qrcode',
        qrCodeSource: 'slug',
        convertBooleans: false,
        booleanFields: [],
        triStateFields: []
    },
    outputNamePattern: '{name}-adoption-flyer.png'
};

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    // Read template HTML from file
    const adoptionFlyerHtml = readTemplateFile('adoption-flyer.html');

    if (!adoptionFlyerHtml) {
        console.error('[DB] Failed to read adoption-flyer template file, skipping');
        return;
    }

    const stmt = db.prepare(`
        INSERT OR IGNORE INTO templates (name, description, html_template, config, is_builtin)
        VALUES (?, ?, ?, ?, ?)
    `);
    stmt.bind([
        'adoption-flyer',
        'Full-page adoption flyer (8.5x11 portrait) - displays large photo, traits list, QR code, and rescue branding',
        adoptionFlyerHtml,
        JSON.stringify(ADOPTION_FLYER_CONFIG),
        1
    ]);
    stmt.step();
    stmt.free();

    console.log('[DB] Added adoption-flyer template');
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    db.run(`DELETE FROM templates WHERE name = 'adoption-flyer'`);
    console.log('[DB] Removed adoption-flyer template');
}

module.exports = { up, down };
