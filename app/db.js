/**
 * Database module for foster-card-generator
 * Encapsulates all SQLite database operations
 * Uses sql.js (pure JavaScript, no native compilation required)
 */

const path = require('path');
const fs = require('fs');
const { getDataDir } = require('./paths.js');

// Load sql.js
let initSqlJs = null;
let databaseLoadError = null;
let wasmPath = null;

try {
    initSqlJs = require('sql.js');
    // Locate the WASM file - try multiple possible locations
    const possiblePaths = [
        path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
        path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    ];
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            wasmPath = p;
            console.log('[DB] Found sql.js WASM at:', wasmPath);
            break;
        }
    }
    if (!wasmPath) {
        console.error('[DB] Could not find sql-wasm.wasm file');
    }
} catch (err) {
    databaseLoadError = err;
    console.error('[DB] Failed to load sql.js:', err.message);
}

// Database state
let db = null;
let DB_PATH = null;
let DB_DIR = null;
let initPromise = null;

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
 * Save database to disk
 */
function saveDatabase() {
    if (!db || !DB_PATH) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

/**
 * Initialize database connection and ensure schema exists (async)
 * @returns {Promise<Object>} - { dbDir, dbPath } paths used
 */
async function initializeAsync() {
    DB_DIR = getDataDir();
    DB_PATH = path.join(DB_DIR, 'animals.db');

    // Create directory if needed
    fs.mkdirSync(DB_DIR, { recursive: true });

    // Check if sql.js is available
    if (!initSqlJs) {
        const errMsg = databaseLoadError
            ? `sql.js failed to load: ${databaseLoadError.message}`
            : 'sql.js module not available';
        throw new Error(errMsg);
    }

    // Initialize sql.js (async) with explicit WASM binary
    let SQL;
    if (wasmPath) {
        // Load WASM binary directly from filesystem
        const wasmBinary = fs.readFileSync(wasmPath);
        SQL = await initSqlJs({ wasmBinary });
    } else {
        // Fallback to default loading (may not work in Electron)
        SQL = await initSqlJs();
    }

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Ensure schema exists
    ensureSchema();

    // Save after schema changes
    saveDatabase();

    return { dbDir: DB_DIR, dbPath: DB_PATH };
}

/**
 * Initialize database connection (maintains sync API by caching promise)
 * Call this and await it, or call initializeAsync directly
 * @returns {Object} - { dbDir, dbPath } paths used
 */
function initialize() {
    if (db) {
        return { dbDir: DB_DIR, dbPath: DB_PATH };
    }

    if (!initPromise) {
        initPromise = initializeAsync();
    }

    // For sync compatibility, throw if not yet initialized
    // Callers should use initializeAsync() or await initialize()
    throw new Error('Database requires async initialization. Use: await db.initializeAsync()');
}

/**
 * Ensure database schema exists
 */
function ensureSchema() {
    // Check if rescues table exists
    const rescuesResult = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='rescues'"
    );

    if (rescuesResult.length === 0) {
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

        db.run(`
            INSERT OR IGNORE INTO rescues (id, name, website, logo_path, org_id, scraper_type) VALUES
                (1, 'Paws Rescue League', 'pawsrescueleague.org', 'logo.png', '1841035', 'wagtopia'),
                (2, 'Brass City Rescue', 'brasscityrescuealliance.org', 'brass-city-logo.jpg', '87063', 'adoptapet')
        `);
    }

    const tableResult = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='animals'"
    );

    if (tableResult.length === 0) {
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

        db.run(`CREATE INDEX IF NOT EXISTS idx_animals_name ON animals(name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_animals_rescue ON animals(rescue_id)`);

        db.run(`
            CREATE TRIGGER IF NOT EXISTS update_animals_timestamp
            AFTER UPDATE ON animals
            BEGIN
                UPDATE animals SET updated_at = datetime('now') WHERE id = NEW.id;
            END
        `);
        return true; // Schema was created
    }

    // Check if rescue_id column exists, add it if not (migration for existing databases)
    const columnsResult = db.exec("PRAGMA table_info(animals)");
    if (columnsResult.length > 0) {
        const columns = columnsResult[0].values;
        const hasRescueId = columns.some(col => col[1] === 'rescue_id');
        if (!hasRescueId) {
            db.run(`ALTER TABLE animals ADD COLUMN rescue_id INTEGER DEFAULT 1`);
            console.log('[DB] Added rescue_id column to existing animals table');
        }
    }

    return false; // Schema already existed
}

/**
 * Close database connection
 */
function close() {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
        initPromise = null;
    }
}

/**
 * Execute raw SQL (for statements that don't return data)
 * @param {string} sql - SQL statement to execute
 */
function exec(sql) {
    if (!db) throw new Error('Database not initialized');
    db.run(sql);
    saveDatabase();
}

/**
 * Query database and return all results
 * @param {string} sql - SQL query
 * @returns {Array} - Array of result rows
 */
function queryAll(sql) {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec(sql);
    if (result.length === 0) return [];

    // Convert to array of objects
    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row[i];
        });
        return obj;
    });
}

/**
 * Query database and return first result
 * @param {string} sql - SQL query
 * @returns {Object|undefined} - First result row or undefined
 */
function queryOne(sql) {
    const results = queryAll(sql);
    return results.length > 0 ? results[0] : undefined;
}

/**
 * Run a prepared statement with parameters
 * @param {string} sql - SQL statement with ? placeholders
 * @param {Array} params - Parameter values
 * @returns {Object} - Result with lastInsertRowid and changes
 */
function runPrepared(sql, params) {
    if (!db) throw new Error('Database not initialized');

    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();

    // Get last insert rowid
    const lastIdResult = db.exec("SELECT last_insert_rowid()");
    const lastInsertRowid = lastIdResult.length > 0 ? lastIdResult[0].values[0][0] : 0;

    // Get changes count
    const changesResult = db.exec("SELECT changes()");
    const changes = changesResult.length > 0 ? changesResult[0].values[0][0] : 0;

    saveDatabase();

    return { lastInsertRowid, changes };
}

/**
 * Query with prepared statement and return first result
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Parameter values
 * @returns {Object|undefined} - First result row or undefined
 */
function queryOnePrepared(sql, params) {
    if (!db) throw new Error('Database not initialized');

    const stmt = db.prepare(sql);
    stmt.bind(params);

    let result = undefined;
    if (stmt.step()) {
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        result = {};
        columns.forEach((col, i) => {
            result[col] = values[i];
        });
    }
    stmt.free();

    return result;
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
    return queryOnePrepared(`
        SELECT id, name, slug, size, shots, housetrained, breed,
               age_long, age_short, gender, kids, dogs, cats,
               portrait_path, portrait_mime, rescue_id
        FROM animals
        WHERE id = ?
    `, [id]);
}

/**
 * Get image data for an animal as a data URL
 * @param {number} animalId - Animal ID
 * @returns {string|null} - Data URL or null if no image
 */
function getImageAsDataUrl(animalId) {
    if (!db) throw new Error('Database not initialized');

    const row = queryOnePrepared(
        'SELECT portrait_mime, portrait_data FROM animals WHERE id = ?',
        [animalId]
    );

    if (!row || !row.portrait_mime || !row.portrait_data) {
        return null;
    }

    // portrait_data is a Uint8Array in sql.js, convert to base64
    const buffer = Buffer.from(row.portrait_data);
    const base64 = buffer.toString('base64');
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
        // Convert hex string to Uint8Array for the BLOB
        const imageBuffer = Buffer.from(imageData.hex, 'hex');

        return runPrepared(`
            INSERT INTO animals (
                name, breed, slug, age_long, age_short, size, gender,
                shots, housetrained, kids, dogs, cats,
                portrait_path, portrait_mime, portrait_data, rescue_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
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
        ]);
    } else {
        return runPrepared(`
            INSERT INTO animals (
                name, breed, slug, age_long, age_short, size, gender,
                shots, housetrained, kids, dogs, cats, rescue_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
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
        ]);
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
        // Convert hex string to Uint8Array for the BLOB
        const imageBuffer = Buffer.from(imageData.hex, 'hex');

        return runPrepared(`
            UPDATE animals SET
                name = ?, breed = ?, slug = ?, age_long = ?, age_short = ?,
                size = ?, gender = ?, shots = ?, housetrained = ?,
                kids = ?, dogs = ?, cats = ?,
                portrait_path = ?, portrait_mime = ?, portrait_data = ?, rescue_id = ?
            WHERE id = ?
        `, [
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
        ]);
    } else {
        return runPrepared(`
            UPDATE animals SET
                name = ?, breed = ?, slug = ?, age_long = ?, age_short = ?,
                size = ?, gender = ?, shots = ?, housetrained = ?,
                kids = ?, dogs = ?, cats = ?, rescue_id = ?
            WHERE id = ?
        `, [
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
        ]);
    }
}

/**
 * Delete an animal by ID
 * @param {number} id - Animal ID
 * @returns {Object} - Result with changes count
 */
function deleteAnimal(id) {
    if (!db) throw new Error('Database not initialized');
    return runPrepared('DELETE FROM animals WHERE id = ?', [id]);
}

/**
 * Delete multiple animals by IDs
 * @param {Array<number>} ids - Array of animal IDs
 * @returns {Object} - { successCount, failCount }
 */
function deleteAnimals(ids) {
    if (!db) throw new Error('Database not initialized');

    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
        try {
            const result = runPrepared('DELETE FROM animals WHERE id = ?', [id]);
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
    return queryOnePrepared(`
        SELECT id, name, website, logo_path, org_id, scraper_type
        FROM rescues
        WHERE id = ?
    `, [id]);
}

/**
 * Get a rescue by scraper type
 * @param {string} scraperType - Scraper type ('wagtopia' or 'adoptapet')
 * @returns {Object|undefined} - Rescue object or undefined
 */
function getRescueByScraperType(scraperType) {
    return queryOnePrepared(`
        SELECT id, name, website, logo_path, org_id, scraper_type
        FROM rescues
        WHERE scraper_type = ?
    `, [scraperType]);
}

// Export all functions
module.exports = {
    // Connection management
    initialize,
    initializeAsync,
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
