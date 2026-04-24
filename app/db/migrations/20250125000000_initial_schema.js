/**
 * Migration: Initial Schema
 * Created: 2025-01-25
 *
 * This migration creates the complete database schema for foster-card-generator.
 * It includes all tables, indexes, triggers, and seeds default data.
 */

const fs = require('fs');
const path = require('path');
const { seedRescues } = require('../seeds.js');

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
    // ========================================
    // Create rescues table
    // ========================================
    db.run(`
        CREATE TABLE IF NOT EXISTS rescues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            website TEXT NOT NULL,
            logo_path TEXT NOT NULL,
            logo_data BLOB,
            logo_mime TEXT,
            org_id TEXT,
            scraper_type TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // ========================================
    // Create animals table
    // ========================================
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
            bio TEXT,
            attributes TEXT DEFAULT '[]',
            photo_urls TEXT DEFAULT '[]',
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

    // ========================================
    // Create print_profiles table
    // ========================================
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

    // ========================================
    // Create templates table
    // ========================================
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

    // ========================================
    // Create settings table
    // ========================================
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

    console.log('[DB] Created all tables, indexes, and triggers');
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // Drop triggers first
    db.run('DROP TRIGGER IF EXISTS update_settings_timestamp');
    db.run('DROP TRIGGER IF EXISTS update_templates_timestamp');
    db.run('DROP TRIGGER IF EXISTS update_print_profiles_timestamp');
    db.run('DROP TRIGGER IF EXISTS update_animals_timestamp');

    // Drop indexes
    db.run('DROP INDEX IF EXISTS idx_templates_name');
    db.run('DROP INDEX IF EXISTS idx_print_profiles_printer');
    db.run('DROP INDEX IF EXISTS idx_animals_rescue');
    db.run('DROP INDEX IF EXISTS idx_animals_name');

    // Drop tables in reverse dependency order
    db.run('DROP TABLE IF EXISTS settings');
    db.run('DROP TABLE IF EXISTS templates');
    db.run('DROP TABLE IF EXISTS print_profiles');
    db.run('DROP TABLE IF EXISTS animals');
    db.run('DROP TABLE IF EXISTS rescues');
}

// Template configurations
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

const CARD_FRONT_CONFIG = {
    ...DEFAULT_CARD_CONFIG
};

const CARD_BACK_CONFIG = {
    ...DEFAULT_CARD_CONFIG,
    preprocessing: {
        ...DEFAULT_CARD_CONFIG.preprocessing,
        generateQrCode: true
    }
};

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
 * Seed initial data
 * @param {Object} db - sql.js database instance
 */
async function seed(db) {
    // Seed rescues (including logo download) via the shared helper in seeds.js.
    await seedRescues(db);

    // ========================================
    // Seed templates
    // ========================================
    const cardFrontHtml = readTemplateFile('card-front.html');
    const cardBackHtml = readTemplateFile('card-back.html');
    const adoptionFlyerHtml = readTemplateFile('adoption-flyer.html');

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
        },
        {
            name: 'adoption-flyer',
            description: 'Full-page adoption flyer (8.5x11 portrait) - displays large photo, traits list, QR code, and rescue branding',
            html_template: adoptionFlyerHtml,
            config: JSON.stringify(ADOPTION_FLYER_CONFIG),
            is_builtin: 1
        }
    ];

    for (const template of templates) {
        if (!template.html_template) {
            console.warn(`[DB] Skipping template ${template.name} - HTML file not found`);
            continue;
        }

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
    console.log('[DB] Seeded templates table with default templates');
}

module.exports = { up, down, seed };
