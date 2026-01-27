/**
 * Migration: Add Templates Table
 * Created: 2025-01-27
 *
 * This migration creates the templates table for storing HTML templates
 * and their render configuration. Templates use Handlebars syntax for
 * variable interpolation and can be customized for different output formats.
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
    // Create templates table
    db.run(`
        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            html_template TEXT NOT NULL,
            config TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Create index for template lookup by name
    db.run(`CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name)`);

    // Create trigger for templates updated_at
    db.run(`
        CREATE TRIGGER IF NOT EXISTS update_templates_timestamp
        AFTER UPDATE ON templates
        BEGIN
            UPDATE templates SET updated_at = datetime('now') WHERE id = NEW.id;
        END
    `);
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    db.run('DROP TRIGGER IF EXISTS update_templates_timestamp');
    db.run('DROP INDEX IF EXISTS idx_templates_name');
    db.run('DROP TABLE IF EXISTS templates');
}

/**
 * Template configuration schema:
 * {
 *   // Page/output settings
 *   pageWidthInches: number,      // Width in inches (e.g., 11 for letter landscape)
 *   pageHeightInches: number,     // Height in inches (e.g., 8.5 for letter landscape)
 *   orientation: 'landscape' | 'portrait',
 *   paperSize: 'letter' | 'a4' | 'custom',
 *   dpi: number,                  // Output DPI (default 360)
 *
 *   // Preprocessing options
 *   preprocessing: {
 *     generateQrCode: boolean,    // Generate QR code from slug/adoptionUrl
 *     qrCodeField: string,        // Field name for QR code (default 'qrcode')
 *     qrCodeSource: string,       // Source field for QR data (default 'slug')
 *     convertBooleans: boolean,   // Convert boolean fields to emoji
 *     booleanFields: string[],    // Fields to convert (default: ['shots', 'housetrained'])
 *     triStateFields: string[],   // Fields with ?, 0, 1 values (default: ['kids', 'dogs', 'cats'])
 *   },
 *
 *   // Output naming
 *   outputNamePattern: string,    // Pattern for output filename (default '{name}-{templateName}.png')
 * }
 */

// Default configuration for card templates
const DEFAULT_CARD_CONFIG = {
    pageWidthInches: 11,
    pageHeightInches: 8.5,
    orientation: 'landscape',
    paperSize: 'letter',
    dpi: 360,
    preprocessing: {
        generateQrCode: false,
        qrCodeField: 'qrcode',
        qrCodeSource: 'slug',
        convertBooleans: true,
        booleanFields: ['shots', 'housetrained'],
        triStateFields: ['kids', 'dogs', 'cats']
    },
    outputNamePattern: '{name}-{templateName}.png'
};

// Card front specific config
const CARD_FRONT_CONFIG = {
    ...DEFAULT_CARD_CONFIG
};

// Card back specific config
const CARD_BACK_CONFIG = {
    ...DEFAULT_CARD_CONFIG,
    preprocessing: {
        ...DEFAULT_CARD_CONFIG.preprocessing,
        generateQrCode: true
    }
};


/**
 * Seed default templates
 * @param {Object} db - sql.js database instance
 */
function seed(db) {
    // Read template HTML from files
    const cardFrontHtml = readTemplateFile('card-front.html');
    const cardBackHtml = readTemplateFile('card-back.html');

    if (!cardFrontHtml || !cardBackHtml) {
        console.error('[DB] Failed to read template files, skipping template seeding');
        return;
    }

    const templates = [
        {
            name: 'card-front',
            description: 'Trading card front side - displays animal photo, name, age, breed, and rescue info',
            html_template: cardFrontHtml,
            config: JSON.stringify(CARD_FRONT_CONFIG),
            is_builtin: 1
        },
        {
            name: 'card-back',
            description: 'Trading card back side - displays QR code and animal details',
            html_template: cardBackHtml,
            config: JSON.stringify(CARD_BACK_CONFIG),
            is_builtin: 1
        }
    ];

    for (const template of templates) {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO templates (name, description, html_template, config, is_builtin)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.bind([
            template.name,
            template.description,
            template.html_template,
            template.config,
            template.is_builtin
        ]);
        stmt.step();
        stmt.free();
    }
    console.log('[DB] Seeded templates table with default card templates from files');
}

module.exports = { up, down, seed };
