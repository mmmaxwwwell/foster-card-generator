/**
 * Database Seed Data
 * Contains initial/default data for the database
 */

const path = require('path');
const fs = require('fs');

const SEEDS_DIR = path.join(__dirname, 'seeds');

/**
 * Default rescue organizations
 */
const DEFAULT_RESCUES = [
    {
        id: 1,
        name: 'Paws Rescue League',
        website: 'pawsrescueleague.org',
        logo_path: 'logo.png',
        org_id: '1841035',
        scraper_type: 'wagtopia'
    },
    {
        id: 2,
        name: 'Brass City Rescue',
        website: 'brasscityrescuealliance.org',
        logo_path: 'brass-city-logo.jpg',
        org_id: '87063',
        scraper_type: 'adoptapet'
    }
];

/**
 * Check if rescues table is empty
 * @param {Object} db - sql.js database instance
 * @returns {boolean}
 */
function isRescuesEmpty(db) {
    const result = db.exec('SELECT COUNT(*) as count FROM rescues');
    if (result.length === 0) return true;
    return result[0].values[0][0] === 0;
}

/**
 * Seed the rescues table with default data
 * @param {Object} db - sql.js database instance
 */
function seedRescues(db) {
    for (const rescue of DEFAULT_RESCUES) {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO rescues (id, name, website, logo_path, org_id, scraper_type)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.bind([
            rescue.id,
            rescue.name,
            rescue.website,
            rescue.logo_path,
            rescue.org_id,
            rescue.scraper_type
        ]);
        stmt.step();
        stmt.free();
    }
    console.log('[DB] Seeded rescues table with default data');
}

/**
 * Run all seed files from the seeds directory
 * @param {Object} db - sql.js database instance
 */
function runSeedFiles(db) {
    if (!fs.existsSync(SEEDS_DIR)) {
        return;
    }

    const files = fs.readdirSync(SEEDS_DIR)
        .filter(f => f.endsWith('.js'))
        .sort();

    for (const file of files) {
        const seedPath = path.join(SEEDS_DIR, file);
        console.log(`[DB] Running seed: ${file}`);

        try {
            const seedModule = require(seedPath);
            if (typeof seedModule.seed === 'function') {
                seedModule.seed(db);
            }
        } catch (err) {
            console.error(`[DB] Seed ${file} failed:`, err.message);
            throw err;
        }
    }
}

/**
 * Run default seeds (only if tables are empty)
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 */
function seedDefaults(db, saveDatabase) {
    let seeded = false;

    // Seed rescues if empty
    if (isRescuesEmpty(db)) {
        seedRescues(db);
        seeded = true;
    }

    // Run any additional seed files
    runSeedFiles(db);

    if (seeded && saveDatabase) {
        saveDatabase();
    }
}

/**
 * Reset and reseed the database (destructive!)
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 */
function reseed(db, saveDatabase) {
    console.log('[DB] Reseeding database...');

    // Clear existing data
    db.run('DELETE FROM animals');
    db.run('DELETE FROM rescues');
    db.run('DELETE FROM print_profiles');

    // Reset auto-increment counters
    db.run("DELETE FROM sqlite_sequence WHERE name='animals'");
    db.run("DELETE FROM sqlite_sequence WHERE name='rescues'");
    db.run("DELETE FROM sqlite_sequence WHERE name='print_profiles'");

    // Re-seed
    seedRescues(db);
    runSeedFiles(db);

    if (saveDatabase) {
        saveDatabase();
    }

    console.log('[DB] Database reseeded');
}

/**
 * Create a new seed file
 * @param {string} name - Seed name
 * @returns {string} - Path to the new seed file
 */
function createSeed(name) {
    if (!fs.existsSync(SEEDS_DIR)) {
        fs.mkdirSync(SEEDS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 14);

    const snakeName = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

    const filename = `${timestamp}_${snakeName}.js`;
    const filepath = path.join(SEEDS_DIR, filename);

    const template = `/**
 * Seed: ${name}
 * Created: ${new Date().toISOString()}
 */

/**
 * Run the seed
 * @param {Object} db - sql.js database instance
 */
function seed(db) {
    // TODO: Add your seed data here
    // Example:
    // const stmt = db.prepare('INSERT INTO table (col1, col2) VALUES (?, ?)');
    // stmt.bind(['value1', 'value2']);
    // stmt.step();
    // stmt.free();
}

module.exports = { seed };
`;

    fs.writeFileSync(filepath, template);
    console.log(`[DB] Created seed file: ${filename}`);
    return filepath;
}

module.exports = {
    DEFAULT_RESCUES,
    seedDefaults,
    seedRescues,
    reseed,
    createSeed,
    SEEDS_DIR
};
