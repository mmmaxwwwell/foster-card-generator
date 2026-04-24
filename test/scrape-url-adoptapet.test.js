// Live-network contract test for app/scrape-url-adoptapet.js.
// Runs on a schedule (weekly cron / manual) to fail loudly when Adoptapet changes their site.

const assert = require('node:assert/strict');
const fs = require('fs').promises;
const { scrapeAnimalPage } = require('../app/scrape-url-adoptapet.js');

const TEST_URL = 'https://www.adoptapet.com/pet/47438600-middlebury-connecticut-american-pit-bull-terrier-mix';

async function main() {
    console.log(`[contract-test] Scraping ${TEST_URL}`);
    const result = await scrapeAnimalPage(TEST_URL);

    assert.equal(result.warnings.length, 0,
        `Expected no warnings, got: ${JSON.stringify(result.warnings)}`);

    assert.equal(result.name, 'Bluey', `name=${result.name}`);
    assert.equal(result.breed, 'American Pit Bull Terrier', `breed=${result.breed}`);

    assert.ok(Array.isArray(result.photoUrls) && result.photoUrls.length >= 1,
        `expected >=1 photoUrl, got ${result.photoUrls.length}`);
    for (const u of result.photoUrls) {
        assert.ok(u.startsWith('https://media.adoptapet.com/image/upload/'),
            `photoUrl has unexpected prefix: ${u}`);
    }

    assert.ok(result.attributes.includes(result.breed),
        `attributes missing breed: ${JSON.stringify(result.attributes)}`);
    const sizes = ['Large', 'Medium', 'Small'];
    assert.ok(result.attributes.some(a => sizes.includes(a)),
        `attributes missing size: ${JSON.stringify(result.attributes)}`);

    assert.ok(result.imagePath, 'imagePath is empty');
    const stat = await fs.stat(result.imagePath);
    assert.ok(stat.size > 0, `imagePath file is zero bytes: ${result.imagePath}`);

    // Clean up downloaded file
    await fs.unlink(result.imagePath).catch(() => {});

    console.log('[contract-test] PASS');
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[contract-test] FAIL');
        console.error(err);
        process.exit(1);
    });
}

module.exports = { main };
