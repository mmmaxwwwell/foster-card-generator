/**
 * Database Seed Data
 * Contains initial/default data for the database
 */

const path = require('path');
const fs = require('fs');
const { DEFAULT_RESCUES } = require('./default-rescues.js');
const { downloadImage } = require('./logo-download.js');

const SEEDS_DIR = path.join(__dirname, 'seeds');

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
 * Insert default rescue rows with logo_data = NULL, then download logos via
 * backfillMissingLogos. Safe to call on a non-empty table — INSERT OR IGNORE
 * preserves existing rows.
 * @param {Object} db - sql.js database instance
 * @returns {Promise<void>}
 */
async function seedRescues(db) {
    for (const rescue of DEFAULT_RESCUES) {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO rescues (id, name, website, logo_path, logo_data, logo_mime, org_id, scraper_type)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
        `);
        stmt.bind([
            rescue.id,
            rescue.name,
            rescue.website,
            rescue.logo_path,
            rescue.logo_mime,
            rescue.org_id,
            rescue.scraper_type
        ]);
        stmt.step();
        stmt.free();
    }
    await backfillMissingLogos(db);
    console.log('[DB] Seeded rescues table with default data');
}

/**
 * Download logos for any rescue row where logo_data IS NULL. User-uploaded
 * logos are preserved because their logo_data is non-NULL. Failed downloads
 * leave the row as-is so the next run can retry.
 * @param {Object} db - sql.js database instance
 * @returns {Promise<number>} - number of rows updated
 */
async function backfillMissingLogos(db) {
    let updated = 0;
    for (const rescue of DEFAULT_RESCUES) {
        if (!rescue.logo_url) continue;

        const res = db.exec(
            'SELECT logo_data FROM rescues WHERE id = ?',
            [rescue.id]
        );
        if (res.length === 0 || res[0].values.length === 0) continue;
        if (res[0].values[0][0] !== null) continue;

        try {
            console.log(`[DB] Downloading logo for ${rescue.name}...`);
            const logoData = await downloadImage(rescue.logo_url);
            const stmt = db.prepare(
                'UPDATE rescues SET logo_data = ?, logo_mime = ? WHERE id = ? AND logo_data IS NULL'
            );
            stmt.bind([logoData, rescue.logo_mime, rescue.id]);
            stmt.step();
            stmt.free();
            updated++;
            console.log(`[DB] Downloaded logo for ${rescue.name} (${logoData.length} bytes)`);
        } catch (err) {
            console.warn(`[DB] Logo download failed for ${rescue.name}: ${err.message}`);
        }
    }
    return updated;
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
 * Run default seeds. Runs the rescue seed if empty, then always runs the logo
 * backfill so rows with NULL logo_data get filled in on restart.
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 * @returns {Promise<void>}
 */
async function seedDefaults(db, saveDatabase) {
    let seeded = false;

    if (isRescuesEmpty(db)) {
        await seedRescues(db);
        seeded = true;
    } else {
        const backfilled = await backfillMissingLogos(db);
        if (backfilled > 0) seeded = true;
    }

    runSeedFiles(db);

    if (seeded && saveDatabase) {
        saveDatabase();
    }
}

/**
 * Reset and reseed the database (destructive!)
 * @param {Object} db - sql.js database instance
 * @param {Function} saveDatabase - Function to save database to disk
 * @returns {Promise<void>}
 */
async function reseed(db, saveDatabase) {
    console.log('[DB] Reseeding database...');

    // Clear existing data
    db.run('DELETE FROM animals');
    db.run('DELETE FROM rescues');
    db.run('DELETE FROM print_profiles');

    // Reset auto-increment counters
    db.run("DELETE FROM sqlite_sequence WHERE name='animals'");
    db.run("DELETE FROM sqlite_sequence WHERE name='rescues'");
    db.run("DELETE FROM sqlite_sequence WHERE name='print_profiles'");

    await seedRescues(db);
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
    backfillMissingLogos,
    reseed,
    createSeed,
    SEEDS_DIR
};
