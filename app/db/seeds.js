/**
 * Database Seed Data
 * Contains initial/default data for the database
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

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
        logo_url: 'https://www.pawsrescueleague.org/uploads/1/3/6/2/136274550/prl-logo-white-background_orig.png',
        logo_mime: 'image/png',
        org_id: '1841035',
        scraper_type: 'wagtopia'
    },
    {
        id: 2,
        name: 'Brass City Rescue',
        website: 'brasscityrescuealliance.org',
        logo_path: 'brass-city-logo.jpg',
        logo_url: null,
        logo_mime: 'image/jpeg',
        org_id: '87063',
        scraper_type: 'adoptapet'
    }
];

/**
 * Download an image from a URL and return as Buffer
 * @param {string} url - URL to download from
 * @returns {Promise<Buffer>} - Image data as buffer
 */
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': `${urlObj.protocol}//${urlObj.hostname}/`,
                'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'same-origin',
            }
        };

        const request = protocol.get(options, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                downloadImage(response.headers.location).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download image: ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });

        request.on('error', reject);
        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

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
 * Seed the rescues table with default data (sync version, no logo download)
 * @param {Object} db - sql.js database instance
 */
function seedRescuesSync(db) {
    for (const rescue of DEFAULT_RESCUES) {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO rescues (id, name, website, logo_path, logo_mime, org_id, scraper_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
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
    console.log('[DB] Seeded rescues table with default data (without logo images)');
}

/**
 * Seed the rescues table with default data including downloading logos
 * @param {Object} db - sql.js database instance
 * @returns {Promise<void>}
 */
async function seedRescues(db) {
    for (const rescue of DEFAULT_RESCUES) {
        let logoData = null;

        // Try to download the logo
        if (rescue.logo_url) {
            try {
                console.log(`[DB] Downloading logo for ${rescue.name}...`);
                logoData = await downloadImage(rescue.logo_url);
                console.log(`[DB] Downloaded logo for ${rescue.name} (${logoData.length} bytes)`);
            } catch (err) {
                console.warn(`[DB] Failed to download logo for ${rescue.name}: ${err.message}`);
            }
        }

        const stmt = db.prepare(`
            INSERT OR IGNORE INTO rescues (id, name, website, logo_path, logo_data, logo_mime, org_id, scraper_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.bind([
            rescue.id,
            rescue.name,
            rescue.website,
            rescue.logo_path,
            logoData,
            rescue.logo_mime,
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
 * @returns {Promise<void>}
 */
async function seedDefaults(db, saveDatabase) {
    let seeded = false;

    // Seed rescues if empty
    if (isRescuesEmpty(db)) {
        await seedRescues(db);
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

    // Re-seed
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
    seedRescuesSync,
    reseed,
    createSeed,
    SEEDS_DIR
};
