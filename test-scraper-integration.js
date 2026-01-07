const { scrapeAnimalPage } = require('./app/scrape-url.js');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

// Use local file for testing if online URL fails
const TEST_URL = process.env.TEST_URL || 'https://www.wagtopia.com/search/pet?id=2553222';
const USE_LOCAL_FILE = process.env.USE_LOCAL_FILE === 'true';
const LOCAL_HTML_FILE = './example page/atticus.html';
const DB_PATH = './db/animals.db';

/**
 * Integration test for scraping animal data and inserting into database
 */
async function runIntegrationTest() {
    console.log('='.repeat(60));
    console.log('SCRAPER INTEGRATION TEST');
    console.log('='.repeat(60));

    let testUrl = TEST_URL;
    if (USE_LOCAL_FILE) {
        testUrl = `file://${path.resolve(LOCAL_HTML_FILE)}`;
        console.log(`Using local file: ${LOCAL_HTML_FILE}`);
    } else {
        console.log(`Test URL: ${TEST_URL}`);
    }
    console.log('');

    try {
        // Step 1: Scrape the animal data
        console.log('[Step 1] Scraping animal data from URL...');
        const scrapedData = await scrapeAnimalPage(testUrl);
        console.log('[Step 1] ✓ Data scraped successfully');
        console.log('');

        // Display scraped data
        console.log('Scraped Data:');
        console.log('-'.repeat(60));
        console.log(`  Name:         ${scrapedData.name}`);
        console.log(`  Breed:        ${scrapedData.breed}`);
        console.log(`  Age (Long):   ${scrapedData.age_long}`);
        console.log(`  Age (Short):  ${scrapedData.age_short}`);
        console.log(`  Size:         ${scrapedData.size}`);
        console.log(`  Gender:       ${scrapedData.gender}`);
        console.log(`  Shots:        ${scrapedData.shots ? 'Yes' : 'No'}`);
        console.log(`  Housetrained: ${scrapedData.housetrained ? 'Yes' : 'No'}`);
        console.log(`  Kids:         ${scrapedData.kids === '1' ? 'Yes' : scrapedData.kids === '0' ? 'No' : 'Unknown'}`);
        console.log(`  Dogs:         ${scrapedData.dogs === '1' ? 'Yes' : scrapedData.dogs === '0' ? 'No' : 'Unknown'}`);
        console.log(`  Cats:         ${scrapedData.cats === '1' ? 'Yes' : scrapedData.cats === '0' ? 'No' : 'Unknown'}`);
        console.log(`  Slug (URL):   ${scrapedData.slug}`);
        console.log(`  Image Path:   ${scrapedData.imagePath || 'None'}`);
        console.log('');

        // Step 2: Verify image was downloaded
        if (scrapedData.imagePath) {
            console.log('[Step 2] Verifying image download...');
            const imageExists = await fs.access(scrapedData.imagePath).then(() => true).catch(() => false);
            if (!imageExists) {
                throw new Error(`Image file not found at: ${scrapedData.imagePath}`);
            }
            const stats = await fs.stat(scrapedData.imagePath);
            console.log(`[Step 2] ✓ Image downloaded (${(stats.size / 1024).toFixed(2)} KB)`);
            console.log('');
        } else {
            console.log('[Step 2] ⚠ Warning: No image was downloaded');
            console.log('');
        }

        // Step 3: Prepare data for database insertion
        console.log('[Step 3] Preparing database insertion...');

        const escapeSQL = (str) => {
            if (str === null || str === undefined) return 'NULL';
            return String(str).replace(/'/g, "''");
        };

        let imageHex = null;
        let imageMime = null;
        let imagePath = null;

        if (scrapedData.imagePath) {
            // Read image file
            const imageData = await fs.readFile(scrapedData.imagePath);
            imageHex = imageData.toString('hex');

            // Determine MIME type
            const ext = scrapedData.imagePath.split('.').pop().toLowerCase();
            const mimeTypes = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp'
            };
            imageMime = mimeTypes[ext] || 'image/jpeg';
            imagePath = path.basename(scrapedData.imagePath);
        }

        console.log('[Step 3] ✓ Data prepared for insertion');
        console.log('');

        // Step 4: Check if animal already exists
        console.log('[Step 4] Checking for existing animal...');
        const checkCmd = `sqlite3 "${DB_PATH}" "SELECT id, name FROM animals WHERE name = '${escapeSQL(scrapedData.name)}';"`;
        let existingId = null;

        try {
            const result = execSync(checkCmd, { encoding: 'utf8' });
            if (result.trim()) {
                existingId = result.trim().split('|')[0];
                console.log(`[Step 4] ⚠ Animal '${scrapedData.name}' already exists with ID: ${existingId}`);
                console.log('[Step 4] Will update existing record...');
            } else {
                console.log('[Step 4] ✓ No existing animal found');
            }
        } catch (err) {
            console.log('[Step 4] ✓ No existing animal found');
        }
        console.log('');

        // Step 5: Insert or update in database
        console.log('[Step 5] Inserting into database...');

        let sql;
        if (existingId) {
            // Update existing record
            if (imageHex) {
                sql = `UPDATE animals SET
                    breed = '${escapeSQL(scrapedData.breed)}',
                    slug = '${escapeSQL(scrapedData.slug)}',
                    age_long = '${escapeSQL(scrapedData.age_long)}',
                    age_short = '${escapeSQL(scrapedData.age_short)}',
                    size = '${escapeSQL(scrapedData.size)}',
                    gender = '${escapeSQL(scrapedData.gender)}',
                    shots = ${scrapedData.shots ? 1 : 0},
                    housetrained = ${scrapedData.housetrained ? 1 : 0},
                    kids = '${escapeSQL(scrapedData.kids)}',
                    dogs = '${escapeSQL(scrapedData.dogs)}',
                    cats = '${escapeSQL(scrapedData.cats)}',
                    portrait_path = '${escapeSQL(imagePath)}',
                    portrait_mime = '${escapeSQL(imageMime)}',
                    portrait_data = X'${imageHex}'
                    WHERE id = ${existingId};`;
            } else {
                sql = `UPDATE animals SET
                    breed = '${escapeSQL(scrapedData.breed)}',
                    slug = '${escapeSQL(scrapedData.slug)}',
                    age_long = '${escapeSQL(scrapedData.age_long)}',
                    age_short = '${escapeSQL(scrapedData.age_short)}',
                    size = '${escapeSQL(scrapedData.size)}',
                    gender = '${escapeSQL(scrapedData.gender)}',
                    shots = ${scrapedData.shots ? 1 : 0},
                    housetrained = ${scrapedData.housetrained ? 1 : 0},
                    kids = '${escapeSQL(scrapedData.kids)}',
                    dogs = '${escapeSQL(scrapedData.dogs)}',
                    cats = '${escapeSQL(scrapedData.cats)}'
                    WHERE id = ${existingId};`;
            }
        } else {
            // Insert new record
            if (imageHex) {
                sql = `INSERT INTO animals (
                    name, breed, slug, age_long, age_short, size, gender, shots, housetrained,
                    kids, dogs, cats, portrait_path, portrait_mime, portrait_data
                ) VALUES (
                    '${escapeSQL(scrapedData.name)}',
                    '${escapeSQL(scrapedData.breed)}',
                    '${escapeSQL(scrapedData.slug)}',
                    '${escapeSQL(scrapedData.age_long)}',
                    '${escapeSQL(scrapedData.age_short)}',
                    '${escapeSQL(scrapedData.size)}',
                    '${escapeSQL(scrapedData.gender)}',
                    ${scrapedData.shots ? 1 : 0},
                    ${scrapedData.housetrained ? 1 : 0},
                    '${escapeSQL(scrapedData.kids)}',
                    '${escapeSQL(scrapedData.dogs)}',
                    '${escapeSQL(scrapedData.cats)}',
                    '${escapeSQL(imagePath)}',
                    '${escapeSQL(imageMime)}',
                    X'${imageHex}'
                );`;
            } else {
                sql = `INSERT INTO animals (
                    name, breed, slug, age_long, age_short, size, gender, shots, housetrained,
                    kids, dogs, cats
                ) VALUES (
                    '${escapeSQL(scrapedData.name)}',
                    '${escapeSQL(scrapedData.breed)}',
                    '${escapeSQL(scrapedData.slug)}',
                    '${escapeSQL(scrapedData.age_long)}',
                    '${escapeSQL(scrapedData.age_short)}',
                    '${escapeSQL(scrapedData.size)}',
                    '${escapeSQL(scrapedData.gender)}',
                    ${scrapedData.shots ? 1 : 0},
                    ${scrapedData.housetrained ? 1 : 0},
                    '${escapeSQL(scrapedData.kids)}',
                    '${escapeSQL(scrapedData.dogs)}',
                    '${escapeSQL(scrapedData.cats)}'
                );`;
            }
        }

        // Use stdin to avoid E2BIG error with large image data
        execSync(`sqlite3 "${DB_PATH}"`, {
            input: sql,
            encoding: 'utf8'
        });
        console.log('[Step 5] ✓ Database insertion successful');
        console.log('');

        // Step 6: Verify the insertion
        console.log('[Step 6] Verifying database entry...');
        const verifyCmd = `sqlite3 -json "${DB_PATH}" "SELECT id, name, breed, size, gender, length(portrait_data) as image_size FROM animals WHERE name = '${escapeSQL(scrapedData.name)}' LIMIT 1;"`;
        const verifyResult = execSync(verifyCmd, { encoding: 'utf8' });
        const dbRecord = JSON.parse(verifyResult)[0];

        console.log('Database Record:');
        console.log('-'.repeat(60));
        console.log(`  ID:           ${dbRecord.id}`);
        console.log(`  Name:         ${dbRecord.name}`);
        console.log(`  Breed:        ${dbRecord.breed}`);
        console.log(`  Size:         ${dbRecord.size}`);
        console.log(`  Gender:       ${dbRecord.gender}`);
        console.log(`  Image Size:   ${dbRecord.image_size ? (dbRecord.image_size / 1024).toFixed(2) + ' KB' : 'No image'}`);
        console.log('[Step 6] ✓ Verification successful');
        console.log('');

        // Step 7: Clean up temporary files
        if (scrapedData.imagePath) {
            console.log('[Step 7] Cleaning up temporary files...');
            try {
                await fs.unlink(scrapedData.imagePath);
                console.log('[Step 7] ✓ Temporary image file deleted');
            } catch (err) {
                console.log('[Step 7] ⚠ Could not delete temporary file:', err.message);
            }
            console.log('');
        }

        // Success summary
        console.log('='.repeat(60));
        console.log('✓ INTEGRATION TEST PASSED');
        console.log('='.repeat(60));
        console.log(`Animal '${scrapedData.name}' has been successfully scraped and`);
        console.log('inserted into the database with image intact!');
        console.log('');
        console.log(`Database ID: ${dbRecord.id}`);
        console.log(`Record: ${existingId ? 'Updated' : 'Created'}`);
        console.log('');

        return true;

    } catch (error) {
        console.error('');
        console.error('='.repeat(60));
        console.error('✗ INTEGRATION TEST FAILED');
        console.error('='.repeat(60));
        console.error('Error:', error.message);
        console.error('');
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run the test
if (require.main === module) {
    runIntegrationTest()
        .then(() => {
            console.log('Test completed successfully.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Test failed:', error);
            process.exit(1);
        });
}

module.exports = { runIntegrationTest };
