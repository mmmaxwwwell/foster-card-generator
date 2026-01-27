/**
 * Migration: Add Logo Blob to Rescues
 * Created: 2025-01-26
 *
 * Adds logo_data (BLOB) and logo_mime (TEXT) columns to rescues table
 * to store logo images directly in the database instead of as file paths.
 */

const https = require('https');
const http = require('http');

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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
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
 * Run the migration
 * @param {Object} db - sql.js database instance
 */
function up(db) {
    // Add logo_data BLOB column for storing logo image data
    db.run(`ALTER TABLE rescues ADD COLUMN logo_data BLOB`);

    // Add logo_mime TEXT column for storing the MIME type
    db.run(`ALTER TABLE rescues ADD COLUMN logo_mime TEXT`);
}

/**
 * Reverse the migration
 * @param {Object} db - sql.js database instance
 */
function down(db) {
    // SQLite doesn't support DROP COLUMN directly in older versions
    // We need to recreate the table without the columns
    db.run(`
        CREATE TABLE rescues_backup (
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
        INSERT INTO rescues_backup (id, name, website, logo_path, org_id, scraper_type, created_at)
        SELECT id, name, website, logo_path, org_id, scraper_type, created_at FROM rescues
    `);

    db.run(`DROP TABLE rescues`);
    db.run(`ALTER TABLE rescues_backup RENAME TO rescues`);
}

/**
 * Seed logo data for existing rescues
 * @param {Object} db - sql.js database instance
 */
async function seed(db) {
    const rescues = [
        {
            id: 1,
            logo_url: 'https://www.pawsrescueleague.org/uploads/1/3/6/2/136274550/prl-logo-white-background_orig.png',
            logo_mime: 'image/png'
        },
        {
            id: 2,
            logo_url: null,
            logo_mime: 'image/jpeg'
        }
    ];

    for (const rescue of rescues) {
        let logoData = null;

        // Download logo if URL is provided
        if (rescue.logo_url) {
            try {
                console.log(`[DB] Downloading logo for rescue ${rescue.id}...`);
                logoData = await downloadImage(rescue.logo_url);
                console.log(`[DB] Downloaded logo (${logoData.length} bytes)`);
            } catch (err) {
                console.warn(`[DB] Failed to download logo for rescue ${rescue.id}: ${err.message}`);
            }
        }

        const stmt = db.prepare(`UPDATE rescues SET logo_data = ?, logo_mime = ? WHERE id = ?`);
        stmt.bind([logoData, rescue.logo_mime, rescue.id]);
        stmt.step();
        stmt.free();
    }
    console.log('[DB] Seeded logo data for existing rescues');
}

module.exports = { up, down, seed };
