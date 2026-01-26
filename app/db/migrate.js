/**
 * Database Migration Runner
 * Pure JavaScript migration system with up/down support
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

/**
 * Ensure migrations tracking table exists
 * @param {Object} db - sql.js database instance
 */
function ensureMigrationsTable(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
        )
    `);
}

/**
 * Get list of applied migrations
 * @param {Object} db - sql.js database instance
 * @returns {Array<string>} - Array of applied migration versions
 */
function getAppliedMigrations(db) {
    const result = db.exec(`SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`);
    if (result.length === 0) return [];
    return result[0].values.map(row => row[0]);
}

/**
 * Get all available migration files
 * @returns {Array<{version: string, name: string, path: string}>}
 */
function getAvailableMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
        return [];
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.js'))
        .sort();

    return files.map(file => {
        // Format: YYYYMMDDHHMMSS_name.js
        const match = file.match(/^(\d{14})_(.+)\.js$/);
        if (!match) return null;
        return {
            version: match[1],
            name: match[2].replace(/_/g, ' '),
            path: path.join(MIGRATIONS_DIR, file)
        };
    }).filter(Boolean);
}

/**
 * Run pending migrations (up)
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 * @returns {Array<string>} - Array of applied migration versions
 */
function runMigrations(db, saveDatabase) {
    ensureMigrationsTable(db);

    const applied = getAppliedMigrations(db);
    const available = getAvailableMigrations();
    const pending = available.filter(m => !applied.includes(m.version));

    const results = [];

    for (const migration of pending) {
        console.log(`[DB] Running migration: ${migration.version}_${migration.name}`);

        try {
            const migrationModule = require(migration.path);

            if (typeof migrationModule.up !== 'function') {
                throw new Error(`Migration ${migration.version} missing up() function`);
            }

            // Run the up migration
            migrationModule.up(db);

            // Record the migration
            const stmt = db.prepare(
                `INSERT INTO ${MIGRATIONS_TABLE} (version, name) VALUES (?, ?)`
            );
            stmt.bind([migration.version, migration.name]);
            stmt.step();
            stmt.free();

            // Save after each successful migration
            if (saveDatabase) saveDatabase();

            results.push(migration.version);
            console.log(`[DB] Applied migration: ${migration.version}`);
        } catch (err) {
            console.error(`[DB] Migration ${migration.version} failed:`, err.message);
            throw err;
        }
    }

    if (results.length === 0) {
        console.log('[DB] No pending migrations');
    }

    return results;
}

/**
 * Rollback the last migration (down)
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 * @returns {string|null} - Rolled back migration version or null
 */
function rollbackMigration(db, saveDatabase) {
    ensureMigrationsTable(db);

    const applied = getAppliedMigrations(db);
    if (applied.length === 0) {
        console.log('[DB] No migrations to rollback');
        return null;
    }

    const lastVersion = applied[applied.length - 1];
    const available = getAvailableMigrations();
    const migration = available.find(m => m.version === lastVersion);

    if (!migration) {
        throw new Error(`Migration file not found for version ${lastVersion}`);
    }

    console.log(`[DB] Rolling back migration: ${migration.version}_${migration.name}`);

    try {
        const migrationModule = require(migration.path);

        if (typeof migrationModule.down !== 'function') {
            throw new Error(`Migration ${migration.version} missing down() function`);
        }

        // Run the down migration
        migrationModule.down(db);

        // Remove the migration record
        const stmt = db.prepare(
            `DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`
        );
        stmt.bind([lastVersion]);
        stmt.step();
        stmt.free();

        // Save after rollback
        if (saveDatabase) saveDatabase();

        console.log(`[DB] Rolled back migration: ${migration.version}`);
        return lastVersion;
    } catch (err) {
        console.error(`[DB] Rollback of ${migration.version} failed:`, err.message);
        throw err;
    }
}

/**
 * Rollback multiple migrations
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 * @param {number} count - Number of migrations to rollback
 * @returns {Array<string>} - Rolled back migration versions
 */
function rollbackMigrations(db, saveDatabase, count = 1) {
    const results = [];
    for (let i = 0; i < count; i++) {
        const version = rollbackMigration(db, saveDatabase);
        if (!version) break;
        results.push(version);
    }
    return results;
}

/**
 * Rollback all migrations
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 * @returns {Array<string>} - Rolled back migration versions
 */
function rollbackAll(db, saveDatabase) {
    const applied = getAppliedMigrations(db);
    return rollbackMigrations(db, saveDatabase, applied.length);
}

/**
 * Get migration status
 * @param {Object} db - sql.js database instance
 * @returns {Object} - Status object with applied, pending, and all migrations
 */
function getMigrationStatus(db) {
    ensureMigrationsTable(db);

    const applied = getAppliedMigrations(db);
    const available = getAvailableMigrations();
    const pending = available.filter(m => !applied.includes(m.version));

    return {
        applied: available.filter(m => applied.includes(m.version)),
        pending,
        all: available
    };
}

/**
 * Generate a new migration file
 * @param {string} name - Migration name (will be snake_cased)
 * @returns {string} - Path to the new migration file
 */
function createMigration(name) {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 14);

    const snakeName = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

    const filename = `${timestamp}_${snakeName}.js`;
    const filepath = path.join(MIGRATIONS_DIR, filename);

    const template = `/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 */

/**
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    // TODO: Add your migration logic here
    // Example:
    // db.run(\`
    //     CREATE TABLE example (
    //         id INTEGER PRIMARY KEY AUTOINCREMENT,
    //         name TEXT NOT NULL
    //     )
    // \`);
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // TODO: Add your rollback logic here
    // Example:
    // db.run('DROP TABLE IF EXISTS example');
}

module.exports = { up, down };
`;

    fs.writeFileSync(filepath, template);
    console.log(`[DB] Created migration: ${filename}`);
    return filepath;
}

module.exports = {
    runMigrations,
    rollbackMigration,
    rollbackMigrations,
    rollbackAll,
    getMigrationStatus,
    getAppliedMigrations,
    getAvailableMigrations,
    createMigration,
    ensureMigrationsTable,
    MIGRATIONS_DIR
};
