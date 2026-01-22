/**
 * Database module for foster-card-generator
 * Encapsulates all SQLite database operations
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Try to load better-sqlite3
let Database = null;
let databaseLoadError = null;
try {
    Database = require('better-sqlite3');
} catch (err) {
    databaseLoadError = err;
    console.error('[DB] Failed to load better-sqlite3:', err.message);
}

// Database state
let db = null;
let DB_PATH = null;
let DB_DIR = null;

/**
 * Get the database directory path
 */
function getDbDir() {
    return DB_DIR;
}

/**
 * Get the database file path
 */
function getDbPath() {
    return DB_PATH;
}

/**
 * Check if database is connected
 */
function isConnected() {
    return db !== null;
}

/**
 * Initialize database connection and ensure schema exists
 * @returns {Object} - { dbDir, dbPath } paths used
 */
function initialize() {
    const homeDir = os.homedir();
    if (!homeDir) {
        throw new Error('Could not determine HOME directory');
    }

    DB_DIR = path.join(homeDir, '.local', 'share', 'foster-card-generator');
    DB_PATH = path.join(DB_DIR, 'animals.db');

    // Create directory if needed
    fs.mkdirSync(DB_DIR, { recursive: true });

    // Check if better-sqlite3 is available
    if (!Database) {
        const errMsg = databaseLoadError
            ? `better-sqlite3 failed to load: ${databaseLoadError.message}`
            : 'better-sqlite3 module not available';
        throw new Error(errMsg);
    }

    // Open database connection
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Ensure schema exists
    ensureSchema();

    return { dbDir: DB_DIR, dbPath: DB_PATH };
}

/**
 * Ensure database schema exists
 */
function ensureSchema() {
    // Check if rescues table exists
    const rescuesExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='rescues'"
    ).get();

    if (!rescuesExists) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS rescues (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                website TEXT NOT NULL,
                logo_path TEXT NOT NULL,
                org_id TEXT,
                scraper_type TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );

            INSERT OR IGNORE INTO rescues (id, name, website, logo_path, org_id, scraper_type) VALUES
                (1, 'Paws Rescue League', 'pawsrescueleague.org', 'logo.png', '1841035', 'wagtopia'),
                (2, 'Brass City Rescue', 'brasscityrescuealliance.org', 'brass-city-logo.jpg', '87063', 'adoptapet');
        `);
    }

    const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='animals'"
    ).get();

    if (!tableExists) {
        db.exec(`
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

            CREATE INDEX IF NOT EXISTS idx_animals_name ON animals(name);
            CREATE INDEX IF NOT EXISTS idx_animals_rescue ON animals(rescue_id);

            CREATE TRIGGER IF NOT EXISTS update_animals_timestamp
            AFTER UPDATE ON animals
            BEGIN
                UPDATE animals SET updated_at = datetime('now') WHERE id = NEW.id;
            END;
        `);
        return true; // Schema was created
    }

    // Check if rescue_id column exists, add it if not (migration for existing databases)
    const columns = db.prepare("PRAGMA table_info(animals)").all();
    const hasRescueId = columns.some(col => col.name === 'rescue_id');
    if (!hasRescueId) {
        db.exec(`ALTER TABLE animals ADD COLUMN rescue_id INTEGER DEFAULT 1`);
        console.log('[DB] Added rescue_id column to existing animals table');
    }

    return false; // Schema already existed
}

/**
 * Close database connection
 */
function close() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Execute raw SQL (for statements that don't return data)
 * @param {string} sql - SQL statement to execute
 */
function exec(sql) {
    if (!db) throw new Error('Database not initialized');
    db.exec(sql);
}

/**
 * Query database and return all results
 * @param {string} sql - SQL query
 * @returns {Array} - Array of result rows
 */
function queryAll(sql) {
    if (!db) throw new Error('Database not initialized');
    return db.prepare(sql).all();
}

/**
 * Query database and return first result
 * @param {string} sql - SQL query
 * @returns {Object|undefined} - First result row or undefined
 */
function queryOne(sql) {
    if (!db) throw new Error('Database not initialized');
    return db.prepare(sql).get();
}

// ============================================================
// Animal CRUD Operations
// ============================================================

/**
 * Get all animals (without portrait data for list view)
 * @returns {Array} - Array of animal objects
 */
function getAllAnimals() {
    return queryAll(`
        SELECT id, name, slug, size, shots, housetrained, breed,
               age_long, age_short, gender, kids, dogs, cats,
               portrait_path, portrait_mime, rescue_id
        FROM animals
        ORDER BY name
    `);
}

/**
 * Get a single animal by ID
 * @param {number} id - Animal ID
 * @returns {Object|undefined} - Animal object or undefined
 */
function getAnimalById(id) {
    if (!db) throw new Error('Database not initialized');
    return db.prepare(`
        SELECT id, name, slug, size, shots, housetrained, breed,
               age_long, age_short, gender, kids, dogs, cats,
               portrait_path, portrait_mime, rescue_id
        FROM animals
        WHERE id = ?
    `).get(id);
}

/**
 * Get image data for an animal as a data URL
 * @param {number} animalId - Animal ID
 * @returns {string|null} - Data URL or null if no image
 */
function getImageAsDataUrl(animalId) {
    if (!db) throw new Error('Database not initialized');

    const row = db.prepare(
        'SELECT portrait_mime, portrait_data FROM animals WHERE id = ?'
    ).get(animalId);

    if (!row || !row.portrait_mime || !row.portrait_data) {
        return null;
    }

    // portrait_data is a Buffer in better-sqlite3, convert to base64
    const base64 = row.portrait_data.toString('base64');
    return `data:${row.portrait_mime};base64,${base64}`;
}

/**
 * Create a new animal
 * @param {Object} animal - Animal data
 * @param {Object} imageData - Optional image data { hex, mime, path }
 * @returns {Object} - Result with lastInsertRowid
 */
function createAnimal(animal, imageData = null) {
    if (!db) throw new Error('Database not initialized');

    const rescueId = animal.rescue_id || 1;

    if (imageData) {
        const stmt = db.prepare(`
            INSERT INTO animals (
                name, breed, slug, age_long, age_short, size, gender,
                shots, housetrained, kids, dogs, cats,
                portrait_path, portrait_mime, portrait_data, rescue_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Convert hex string to buffer for the BLOB
        const imageBuffer = Buffer.from(imageData.hex, 'hex');

        return stmt.run(
            animal.name,
            animal.breed,
            animal.slug,
            animal.age_long,
            animal.age_short,
            animal.size,
            animal.gender,
            animal.shots ? 1 : 0,
            animal.housetrained ? 1 : 0,
            animal.kids,
            animal.dogs,
            animal.cats,
            imageData.path,
            imageData.mime,
            imageBuffer,
            rescueId
        );
    } else {
        const stmt = db.prepare(`
            INSERT INTO animals (
                name, breed, slug, age_long, age_short, size, gender,
                shots, housetrained, kids, dogs, cats, rescue_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        return stmt.run(
            animal.name,
            animal.breed,
            animal.slug,
            animal.age_long,
            animal.age_short,
            animal.size,
            animal.gender,
            animal.shots ? 1 : 0,
            animal.housetrained ? 1 : 0,
            animal.kids,
            animal.dogs,
            animal.cats,
            rescueId
        );
    }
}

/**
 * Update an existing animal
 * @param {number} id - Animal ID
 * @param {Object} animal - Animal data
 * @param {Object} imageData - Optional image data { hex, mime, path }
 * @returns {Object} - Result with changes count
 */
function updateAnimal(id, animal, imageData = null) {
    if (!db) throw new Error('Database not initialized');

    const rescueId = animal.rescue_id || 1;

    if (imageData) {
        const stmt = db.prepare(`
            UPDATE animals SET
                name = ?, breed = ?, slug = ?, age_long = ?, age_short = ?,
                size = ?, gender = ?, shots = ?, housetrained = ?,
                kids = ?, dogs = ?, cats = ?,
                portrait_path = ?, portrait_mime = ?, portrait_data = ?, rescue_id = ?
            WHERE id = ?
        `);

        // Convert hex string to buffer for the BLOB
        const imageBuffer = Buffer.from(imageData.hex, 'hex');

        return stmt.run(
            animal.name,
            animal.breed,
            animal.slug,
            animal.age_long,
            animal.age_short,
            animal.size,
            animal.gender,
            animal.shots ? 1 : 0,
            animal.housetrained ? 1 : 0,
            animal.kids,
            animal.dogs,
            animal.cats,
            imageData.path,
            imageData.mime,
            imageBuffer,
            rescueId,
            id
        );
    } else {
        const stmt = db.prepare(`
            UPDATE animals SET
                name = ?, breed = ?, slug = ?, age_long = ?, age_short = ?,
                size = ?, gender = ?, shots = ?, housetrained = ?,
                kids = ?, dogs = ?, cats = ?, rescue_id = ?
            WHERE id = ?
        `);

        return stmt.run(
            animal.name,
            animal.breed,
            animal.slug,
            animal.age_long,
            animal.age_short,
            animal.size,
            animal.gender,
            animal.shots ? 1 : 0,
            animal.housetrained ? 1 : 0,
            animal.kids,
            animal.dogs,
            animal.cats,
            rescueId,
            id
        );
    }
}

/**
 * Delete an animal by ID
 * @param {number} id - Animal ID
 * @returns {Object} - Result with changes count
 */
function deleteAnimal(id) {
    if (!db) throw new Error('Database not initialized');
    return db.prepare('DELETE FROM animals WHERE id = ?').run(id);
}

/**
 * Delete multiple animals by IDs
 * @param {Array<number>} ids - Array of animal IDs
 * @returns {Object} - { successCount, failCount }
 */
function deleteAnimals(ids) {
    if (!db) throw new Error('Database not initialized');

    const stmt = db.prepare('DELETE FROM animals WHERE id = ?');
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
        try {
            const result = stmt.run(id);
            if (result.changes > 0) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (err) {
            console.error(`[DB] Error deleting animal ${id}:`, err);
            failCount++;
        }
    }

    return { successCount, failCount };
}

// ============================================================
// Rescue Operations
// ============================================================

/**
 * Get all rescues
 * @returns {Array} - Array of rescue objects
 */
function getAllRescues() {
    return queryAll(`
        SELECT id, name, website, logo_path, org_id, scraper_type
        FROM rescues
        ORDER BY name
    `);
}

/**
 * Get a rescue by ID
 * @param {number} id - Rescue ID
 * @returns {Object|undefined} - Rescue object or undefined
 */
function getRescueById(id) {
    if (!db) throw new Error('Database not initialized');
    return db.prepare(`
        SELECT id, name, website, logo_path, org_id, scraper_type
        FROM rescues
        WHERE id = ?
    `).get(id);
}

/**
 * Get a rescue by scraper type
 * @param {string} scraperType - Scraper type ('wagtopia' or 'adoptapet')
 * @returns {Object|undefined} - Rescue object or undefined
 */
function getRescueByScraperType(scraperType) {
    if (!db) throw new Error('Database not initialized');
    return db.prepare(`
        SELECT id, name, website, logo_path, org_id, scraper_type
        FROM rescues
        WHERE scraper_type = ?
    `).get(scraperType);
}

// Export all functions
module.exports = {
    // Connection management
    initialize,
    close,
    isConnected,
    getDbDir,
    getDbPath,

    // Raw SQL (for backward compatibility)
    exec,
    queryAll,
    queryOne,

    // Animal CRUD
    getAllAnimals,
    getAnimalById,
    getImageAsDataUrl,
    createAnimal,
    updateAnimal,
    deleteAnimal,
    deleteAnimals,

    // Rescue operations
    getAllRescues,
    getRescueById,
    getRescueByScraperType
};
