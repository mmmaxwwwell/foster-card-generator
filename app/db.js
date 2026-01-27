/**
 * Database module for foster-card-generator
 * Encapsulates all SQLite database operations
 * Uses sql.js (pure JavaScript, no native compilation required)
 */

const path = require('path');
const fs = require('fs');
const { getDataDir } = require('./paths.js');
const { runMigrations, getMigrationStatus, getAppliedMigrations } = require('./db/migrate.js');
const { seedDefaults } = require('./db/seeds.js');

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

    // Handle existing databases (pre-migration system)
    markExistingDatabaseAsMigrated(db);

    // Run migrations
    const appliedMigrations = runMigrations(db, saveDatabase);
    if (appliedMigrations.length > 0) {
        console.log(`[DB] Applied ${appliedMigrations.length} migration(s)`);
    }

    // Seed default data if needed (async - downloads logos)
    await seedDefaults(db, saveDatabase);

    // Save after schema/seed changes
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
 * Mark an existing database as having all migrations applied
 * This is used for databases created before the migration system
 * @param {Object} db - sql.js database instance
 */
function markExistingDatabaseAsMigrated(db) {
    const { ensureMigrationsTable, getAvailableMigrations, getAppliedMigrations } = require('./db/migrate.js');

    ensureMigrationsTable(db);

    // Check if tables already exist (pre-migration database)
    const tablesResult = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rescues', 'animals', 'print_profiles')"
    );

    if (tablesResult.length > 0 && tablesResult[0].values.length >= 2) {
        // Database has existing tables, check if migrations are tracked
        const applied = getAppliedMigrations(db);

        if (applied.length === 0) {
            // Mark initial migration as applied since schema already exists
            const available = getAvailableMigrations();
            const initialMigration = available.find(m => m.name.includes('initial'));

            if (initialMigration) {
                console.log('[DB] Marking existing database as migrated');
                const stmt = db.prepare(
                    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
                );
                stmt.bind([initialMigration.version, initialMigration.name]);
                stmt.step();
                stmt.free();
            }
        }
    }
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
               portrait_path, portrait_mime, rescue_id, attributes, bio
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
               portrait_path, portrait_mime, rescue_id, attributes, bio
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
    const attributesJson = JSON.stringify(Array.isArray(animal.attributes) ? animal.attributes.slice(0, 16) : []);

    if (imageData) {
        // Convert hex string to Uint8Array for the BLOB
        const imageBuffer = Buffer.from(imageData.hex, 'hex');

        return runPrepared(`
            INSERT INTO animals (
                name, breed, slug, age_long, age_short, size, gender,
                shots, housetrained, kids, dogs, cats,
                portrait_path, portrait_mime, portrait_data, rescue_id, attributes, bio
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            attributesJson,
            animal.bio || null
        ]);
    } else {
        return runPrepared(`
            INSERT INTO animals (
                name, breed, slug, age_long, age_short, size, gender,
                shots, housetrained, kids, dogs, cats, rescue_id, attributes, bio
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            attributesJson,
            animal.bio || null
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
                portrait_path = ?, portrait_mime = ?, portrait_data = ?, rescue_id = ?, bio = ?
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
            animal.bio || null,
            id
        ]);
    } else {
        return runPrepared(`
            UPDATE animals SET
                name = ?, breed = ?, slug = ?, age_long = ?, age_short = ?,
                size = ?, gender = ?, shots = ?, housetrained = ?,
                kids = ?, dogs = ?, cats = ?, rescue_id = ?, bio = ?
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
            animal.bio || null,
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
 * Get attributes for an animal
 * @param {number} id - Animal ID
 * @returns {Array} - Array of attribute strings (max 16)
 */
function getAnimalAttributes(id) {
    if (!db) throw new Error('Database not initialized');
    const row = queryOnePrepared('SELECT attributes FROM animals WHERE id = ?', [id]);
    if (!row || !row.attributes) return [];
    try {
        const attrs = JSON.parse(row.attributes);
        return Array.isArray(attrs) ? attrs.slice(0, 16) : [];
    } catch {
        return [];
    }
}

/**
 * Update attributes for an animal
 * @param {number} id - Animal ID
 * @param {Array} attributes - Array of attribute strings (max 16)
 * @returns {Object} - Result with changes count
 */
function updateAnimalAttributes(id, attributes) {
    if (!db) throw new Error('Database not initialized');
    // Ensure max 16 attributes and filter empty strings
    const cleanAttrs = (Array.isArray(attributes) ? attributes : [])
        .filter(a => typeof a === 'string' && a.trim())
        .slice(0, 16);
    return runPrepared('UPDATE animals SET attributes = ? WHERE id = ?', [JSON.stringify(cleanAttrs), id]);
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
        SELECT id, name, website, logo_path, logo_data, logo_mime, org_id, scraper_type
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
        SELECT id, name, website, logo_path, logo_data, logo_mime, org_id, scraper_type
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
        SELECT id, name, website, logo_path, logo_data, logo_mime, org_id, scraper_type
        FROM rescues
        WHERE scraper_type = ?
    `, [scraperType]);
}

/**
 * Get rescue logo as data URL
 * @param {number} rescueId - Rescue ID
 * @returns {string|null} - Data URL or null if no logo
 */
function getRescueLogoAsDataUrl(rescueId) {
    if (!db) throw new Error('Database not initialized');

    const row = queryOnePrepared(
        'SELECT logo_mime, logo_data FROM rescues WHERE id = ?',
        [rescueId]
    );

    if (!row || !row.logo_mime || !row.logo_data) {
        return null;
    }

    const buffer = Buffer.from(row.logo_data);
    const base64 = buffer.toString('base64');
    return `data:${row.logo_mime};base64,${base64}`;
}

/**
 * Create a new rescue
 * @param {Object} rescue - Rescue data
 * @param {Object} logoData - Optional logo data { hex, mime, path }
 * @returns {Object} - Result with lastInsertRowid
 */
function createRescue(rescue, logoData = null) {
    if (!db) throw new Error('Database not initialized');

    if (logoData) {
        const logoBuffer = Buffer.from(logoData.hex, 'hex');

        return runPrepared(`
            INSERT INTO rescues (name, website, logo_path, logo_data, logo_mime, org_id, scraper_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            rescue.name,
            rescue.website || null,
            logoData.path || null,
            logoBuffer,
            logoData.mime,
            rescue.org_id || null,
            rescue.scraper_type || null
        ]);
    } else {
        return runPrepared(`
            INSERT INTO rescues (name, website, org_id, scraper_type)
            VALUES (?, ?, ?, ?)
        `, [
            rescue.name,
            rescue.website || null,
            rescue.org_id || null,
            rescue.scraper_type || null
        ]);
    }
}

/**
 * Update an existing rescue
 * @param {number} id - Rescue ID
 * @param {Object} rescue - Rescue data
 * @param {Object} logoData - Optional logo data { hex, mime, path }
 * @returns {Object} - Result with changes count
 */
function updateRescue(id, rescue, logoData = null) {
    if (!db) throw new Error('Database not initialized');

    if (logoData) {
        const logoBuffer = Buffer.from(logoData.hex, 'hex');

        return runPrepared(`
            UPDATE rescues SET
                name = ?, website = ?, logo_path = ?, logo_data = ?, logo_mime = ?,
                org_id = ?, scraper_type = ?
            WHERE id = ?
        `, [
            rescue.name,
            rescue.website || null,
            logoData.path || null,
            logoBuffer,
            logoData.mime,
            rescue.org_id || null,
            rescue.scraper_type || null,
            id
        ]);
    } else {
        return runPrepared(`
            UPDATE rescues SET
                name = ?, website = ?, org_id = ?, scraper_type = ?
            WHERE id = ?
        `, [
            rescue.name,
            rescue.website || null,
            rescue.org_id || null,
            rescue.scraper_type || null,
            id
        ]);
    }
}

/**
 * Delete a rescue by ID
 * @param {number} id - Rescue ID
 * @returns {Object} - Result with changes count
 */
function deleteRescue(id) {
    if (!db) throw new Error('Database not initialized');

    // Check if any animals reference this rescue
    const animalCount = queryOnePrepared(
        'SELECT COUNT(*) as count FROM animals WHERE rescue_id = ?',
        [id]
    );

    if (animalCount && animalCount.count > 0) {
        throw new Error(`Cannot delete rescue: ${animalCount.count} animal(s) are associated with it`);
    }

    return runPrepared('DELETE FROM rescues WHERE id = ?', [id]);
}

// ============================================================
// Print Profile Operations
// ============================================================

/**
 * Get all print profiles
 * @returns {Array} - Array of print profile objects
 */
function getAllPrintProfiles() {
    return queryAll(`
        SELECT id, name, printer_name, copies, paper_size, orientation, paper_source, is_default,
               calibration_ab, calibration_bc, calibration_cd, calibration_da,
               border_top, border_right, border_bottom, border_left
        FROM print_profiles
        ORDER BY printer_name, name
    `);
}

/**
 * Get print profiles for a specific printer
 * @param {string} printerName - Printer name
 * @returns {Array} - Array of print profile objects
 */
function getPrintProfilesByPrinter(printerName) {
    if (!db) throw new Error('Database not initialized');

    const stmt = db.prepare(`
        SELECT id, name, printer_name, copies, paper_size, orientation, paper_source, is_default,
               calibration_ab, calibration_bc, calibration_cd, calibration_da,
               border_top, border_right, border_bottom, border_left
        FROM print_profiles
        WHERE printer_name = ?
        ORDER BY is_default DESC, name
    `);
    stmt.bind([printerName]);

    const results = [];
    while (stmt.step()) {
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        const row = {};
        columns.forEach((col, i) => {
            row[col] = values[i];
        });
        results.push(row);
    }
    stmt.free();

    return results;
}

/**
 * Get a print profile by ID
 * @param {number} id - Profile ID
 * @returns {Object|undefined} - Print profile object or undefined
 */
function getPrintProfileById(id) {
    return queryOnePrepared(`
        SELECT id, name, printer_name, copies, paper_size, orientation, paper_source, is_default,
               calibration_ab, calibration_bc, calibration_cd, calibration_da,
               border_top, border_right, border_bottom, border_left
        FROM print_profiles
        WHERE id = ?
    `, [id]);
}

/**
 * Get the default print profile for a printer
 * @param {string} printerName - Printer name
 * @returns {Object|undefined} - Print profile object or undefined
 */
function getDefaultPrintProfileForPrinter(printerName) {
    return queryOnePrepared(`
        SELECT id, name, printer_name, copies, paper_size, orientation, paper_source, is_default,
               calibration_ab, calibration_bc, calibration_cd, calibration_da,
               border_top, border_right, border_bottom, border_left
        FROM print_profiles
        WHERE printer_name = ? AND is_default = 1
    `, [printerName]);
}

/**
 * Create a new print profile
 * @param {Object} profile - Profile data
 * @returns {Object} - Result with lastInsertRowid
 */
function createPrintProfile(profile) {
    if (!db) throw new Error('Database not initialized');

    // If this is set as default, clear other defaults for this printer first
    if (profile.is_default) {
        runPrepared(
            `UPDATE print_profiles SET is_default = 0 WHERE printer_name = ?`,
            [profile.printer_name]
        );
    }

    return runPrepared(`
        INSERT INTO print_profiles (
            name, printer_name, copies, paper_size, orientation, paper_source, is_default,
            calibration_ab, calibration_bc, calibration_cd, calibration_da,
            border_top, border_right, border_bottom, border_left
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        profile.name,
        profile.printer_name,
        profile.copies || 1,
        profile.paper_size || 'letter',
        profile.orientation || 'landscape',
        profile.paper_source || 'default',
        profile.is_default ? 1 : 0,
        profile.calibration_ab || null,
        profile.calibration_bc || null,
        profile.calibration_cd || null,
        profile.calibration_da || null,
        profile.border_top || null,
        profile.border_right || null,
        profile.border_bottom || null,
        profile.border_left || null
    ]);
}

/**
 * Update an existing print profile
 * @param {number} id - Profile ID
 * @param {Object} profile - Profile data
 * @returns {Object} - Result with changes count
 */
function updatePrintProfile(id, profile) {
    if (!db) throw new Error('Database not initialized');

    // If this is set as default, clear other defaults for this printer first
    if (profile.is_default) {
        runPrepared(
            `UPDATE print_profiles SET is_default = 0 WHERE printer_name = ? AND id != ?`,
            [profile.printer_name, id]
        );
    }

    return runPrepared(`
        UPDATE print_profiles SET
            name = ?, printer_name = ?, copies = ?, paper_size = ?,
            orientation = ?, paper_source = ?, is_default = ?,
            calibration_ab = ?, calibration_bc = ?, calibration_cd = ?, calibration_da = ?,
            border_top = ?, border_right = ?, border_bottom = ?, border_left = ?
        WHERE id = ?
    `, [
        profile.name,
        profile.printer_name,
        profile.copies || 1,
        profile.paper_size || 'letter',
        profile.orientation || 'landscape',
        profile.paper_source || 'default',
        profile.is_default ? 1 : 0,
        profile.calibration_ab || null,
        profile.calibration_bc || null,
        profile.calibration_cd || null,
        profile.calibration_da || null,
        profile.border_top || null,
        profile.border_right || null,
        profile.border_bottom || null,
        profile.border_left || null,
        id
    ]);
}

/**
 * Delete a print profile
 * @param {number} id - Profile ID
 * @returns {Object} - Result with changes count
 */
function deletePrintProfile(id) {
    if (!db) throw new Error('Database not initialized');
    return runPrepared('DELETE FROM print_profiles WHERE id = ?', [id]);
}

/**
 * Set a print profile as the default for its printer
 * @param {number} id - Profile ID
 * @returns {Object} - Result with changes count
 */
function setDefaultPrintProfile(id) {
    if (!db) throw new Error('Database not initialized');

    // Get the printer name for this profile
    const profile = getPrintProfileById(id);
    if (!profile) {
        throw new Error('Profile not found');
    }

    // Clear other defaults for this printer
    runPrepared(
        `UPDATE print_profiles SET is_default = 0 WHERE printer_name = ?`,
        [profile.printer_name]
    );

    // Set this one as default
    return runPrepared(
        `UPDATE print_profiles SET is_default = 1 WHERE id = ?`,
        [id]
    );
}

// ============================================================
// Template Operations
// ============================================================

/**
 * Get all templates
 * @returns {Array} - Array of template objects (without html_template for list view)
 */
function getAllTemplates() {
    return queryAll(`
        SELECT id, name, description, config, is_builtin, created_at, updated_at
        FROM templates
        ORDER BY is_builtin DESC, name
    `);
}

/**
 * Get a template by ID
 * @param {number} id - Template ID
 * @returns {Object|undefined} - Template object with parsed config
 */
function getTemplateById(id) {
    const template = queryOnePrepared(`
        SELECT id, name, description, html_template, config, is_builtin, created_at, updated_at
        FROM templates
        WHERE id = ?
    `, [id]);

    if (template && template.config) {
        template.config = JSON.parse(template.config);
    }
    return template;
}

/**
 * Get a template by name
 * @param {string} name - Template name
 * @returns {Object|undefined} - Template object with parsed config
 */
function getTemplateByName(name) {
    const template = queryOnePrepared(`
        SELECT id, name, description, html_template, config, is_builtin, created_at, updated_at
        FROM templates
        WHERE name = ?
    `, [name]);

    if (template && template.config) {
        template.config = JSON.parse(template.config);
    }
    return template;
}

/**
 * Create a new template
 * @param {Object} template - Template data { name, description, html_template, config }
 * @returns {Object} - Result with lastInsertRowid
 */
function createTemplate(template) {
    if (!db) throw new Error('Database not initialized');

    const configStr = typeof template.config === 'string'
        ? template.config
        : JSON.stringify(template.config);

    return runPrepared(`
        INSERT INTO templates (name, description, html_template, config, is_builtin)
        VALUES (?, ?, ?, ?, ?)
    `, [
        template.name,
        template.description || null,
        template.html_template,
        configStr,
        template.is_builtin ? 1 : 0
    ]);
}

/**
 * Update an existing template
 * @param {number} id - Template ID
 * @param {Object} template - Template data
 * @returns {Object} - Result with changes count
 */
function updateTemplate(id, template) {
    if (!db) throw new Error('Database not initialized');

    const configStr = typeof template.config === 'string'
        ? template.config
        : JSON.stringify(template.config);

    return runPrepared(`
        UPDATE templates SET
            name = ?, description = ?, html_template = ?, config = ?
        WHERE id = ?
    `, [
        template.name,
        template.description || null,
        template.html_template,
        configStr,
        id
    ]);
}

/**
 * Delete a template by ID (only non-builtin templates can be deleted)
 * @param {number} id - Template ID
 * @returns {Object} - Result with changes count
 */
function deleteTemplate(id) {
    if (!db) throw new Error('Database not initialized');

    // Check if template is builtin
    const template = getTemplateById(id);
    if (template && template.is_builtin) {
        throw new Error('Cannot delete built-in template');
    }

    return runPrepared('DELETE FROM templates WHERE id = ? AND is_builtin = 0', [id]);
}

// ============================================================
// Settings Operations
// ============================================================

/**
 * Get a setting value by key
 * @param {string} key - Setting key
 * @returns {string|null} - Setting value or null if not found
 */
function getSetting(key) {
    if (!db) throw new Error('Database not initialized');
    const row = queryOnePrepared('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
}

/**
 * Get all settings
 * @returns {Object} - Object with all settings as key-value pairs
 */
function getAllSettings() {
    if (!db) throw new Error('Database not initialized');
    const rows = queryAll('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
}

/**
 * Set a setting value (insert or update)
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Object} - Result with changes count
 */
function setSetting(key, value) {
    if (!db) throw new Error('Database not initialized');
    return runPrepared(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, value]);
}

/**
 * Delete a setting
 * @param {string} key - Setting key
 * @returns {Object} - Result with changes count
 */
function deleteSetting(key) {
    if (!db) throw new Error('Database not initialized');
    return runPrepared('DELETE FROM settings WHERE key = ?', [key]);
}

// Re-export migration and seed functions for external use
const migrate = require('./db/migrate.js');
const seeds = require('./db/seeds.js');

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
    getAnimalAttributes,
    updateAnimalAttributes,

    // Rescue operations
    getAllRescues,
    getRescueById,
    getRescueByScraperType,
    getRescueLogoAsDataUrl,
    createRescue,
    updateRescue,
    deleteRescue,

    // Print profile operations
    getAllPrintProfiles,
    getPrintProfilesByPrinter,
    getPrintProfileById,
    getDefaultPrintProfileForPrinter,
    createPrintProfile,
    updatePrintProfile,
    deletePrintProfile,
    setDefaultPrintProfile,

    // Template operations
    getAllTemplates,
    getTemplateById,
    getTemplateByName,
    createTemplate,
    updateTemplate,
    deleteTemplate,

    // Settings operations
    getSetting,
    getAllSettings,
    setSetting,
    deleteSetting,

    // Migration utilities
    migrations: {
        run: () => runMigrations(db, saveDatabase),
        rollback: (count = 1) => migrate.rollbackMigrations(db, saveDatabase, count),
        rollbackAll: () => migrate.rollbackAll(db, saveDatabase),
        status: () => getMigrationStatus(db),
        create: migrate.createMigration
    },

    // Seed utilities
    seeds: {
        run: () => seeds.seedDefaults(db, saveDatabase),
        reseed: () => seeds.reseed(db, saveDatabase),
        create: seeds.createSeed
    }
};
