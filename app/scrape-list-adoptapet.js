const { launchBrowser } = require('./browser-helper.js');

/**
 * Scrapes the Adoptapet organization page and extracts all animal listings
 * @param {string} url - The organization search URL
 * @returns {Promise<Array>} - Array of animals with name and URL
 */
async function scrapeAnimalList(url) {
    const browser = await launchBrowser();

    try {
        const page = await browser.newPage();

        // Set a reasonable viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Navigate to the page
        console.error(`[Adoptapet List Scraper] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait a bit for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract all animals from the page
        // The Adoptapet portable pet list uses a table format with links to pet details
        const animals = await page.evaluate(() => {
            const results = [];
            const seen = new Set();

            // Find all links that match the pet profile pattern
            // Adoptapet list page uses URLs like https://searchtools.adoptapet.com/pet/47001307-middlebury-connecticut-husky
            // But we need to convert them to www.adoptapet.com for scraping
            const links = document.querySelectorAll('a[href*="/pet/"]');

            for (const link of links) {
                let href = link.href;

                // Extract pet ID and slug from URL like "/pet/47001307-middlebury-connecticut-husky"
                const petMatch = href.match(/\/pet\/(\d+)(-[^?#]*)?/);
                if (!petMatch) continue;

                const petId = petMatch[1];
                const petSlug = petMatch[2] || '';

                // Convert searchtools.adoptapet.com URLs to www.adoptapet.com
                href = `https://www.adoptapet.com/pet/${petId}${petSlug}`;

                // Skip duplicates
                if (seen.has(petId)) continue;
                seen.add(petId);

                // Try to extract name from the link text or nearby elements
                let name = '';

                // Method 1: Direct text content of the link
                if (link.textContent && link.textContent.trim() &&
                    link.textContent.length < 50) {
                    name = link.textContent.trim();
                }

                // Method 2: Look for name in parent row (table structure)
                if (!name) {
                    const row = link.closest('tr');
                    if (row) {
                        // Look for the name cell (usually the second column with class "name")
                        const nameCell = row.querySelector('.name');
                        if (nameCell) {
                            const nameLink = nameCell.querySelector('a');
                            if (nameLink) {
                                name = nameLink.textContent.trim();
                            } else {
                                name = nameCell.textContent.trim();
                            }
                        }
                    }
                }

                // Method 3: Look for nearby heading or name element
                if (!name) {
                    const parent = link.closest('[class*="card"], [class*="pet"], [class*="result"], td');
                    if (parent) {
                        const heading = parent.querySelector('h1, h2, h3, h4, h5, [class*="name"], [class*="title"]');
                        if (heading && heading.textContent && heading.textContent.trim().length < 50) {
                            name = heading.textContent.trim();
                        }
                    }
                }

                // Skip if name looks like it's not actually a name
                if (name && (name.toLowerCase().includes('adopt') ||
                             name.toLowerCase().includes('view') ||
                             name.toLowerCase().includes('more'))) {
                    name = '';
                }

                // Fallback: Use pet ID if no name found
                if (!name) {
                    name = `Pet ${petId}`;
                }

                results.push({
                    name: name,
                    url: href,
                    id: petId
                });
            }

            return results;
        });

        console.error(`[Adoptapet List Scraper] Found ${animals.length} animals`);

        // Log first few for debugging
        if (animals.length > 0) {
            console.error(`[Adoptapet List Scraper] Sample animals:`, animals.slice(0, 3));
        }

        return animals;

    } catch (error) {
        console.error('[Adoptapet List Scraper] Error:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

/**
 * Build the Adoptapet shelter URL from a shelter ID
 * @param {string} shelterId - The shelter ID
 * @returns {string} - The full URL
 */
function buildShelterUrl(shelterId) {
    return `https://searchtools.adoptapet.com/cgi-bin/searchtools.cgi/portable_pet_list?shelter_id=${shelterId}`;
}

// CLI interface
if (require.main === module) {
    // Accept either a full URL or just a shelter ID
    const arg = process.argv[2] || '87063';
    const url = arg.startsWith('http') ? arg : buildShelterUrl(arg);

    scrapeAnimalList(url)
        .then(animals => {
            // Output as JSON to stdout
            console.log(JSON.stringify(animals));
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed:', error.message);
            process.exit(1);
        });
}

module.exports = { scrapeAnimalList, buildShelterUrl };
