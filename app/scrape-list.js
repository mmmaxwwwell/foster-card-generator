const puppeteer = require('puppeteer');

/**
 * Scrapes the organization page and extracts all animal listings
 * @param {string} url - The organization search URL
 * @returns {Promise<Array>} - Array of animals with name and URL
 */
async function scrapeAnimalList(url) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Set a reasonable viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Navigate to the page
        console.error(`[List Scraper] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait a bit for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Collect all animals from all pages (maximum 5 pages)
        const allAnimals = [];
        const seenIds = new Set();
        const MAX_PAGES = 5;
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && currentPage <= MAX_PAGES) {
            console.error(`[List Scraper] Scraping page ${currentPage}`);

            // Check if we've hit the "no results" message
            const noResultsFound = await page.evaluate(() => {
                const bodyText = document.body.textContent || '';
                return bodyText.includes("We couldn't find any pets matching your filters");
            });

            if (noResultsFound) {
                console.error(`[List Scraper] Found "no results" message, stopping pagination`);
                hasMorePages = false;
                break;
            }

            // Extract all animal links and names from the current page
            const animals = await page.evaluate(() => {
                const results = [];

                // Find all links that match the pet profile pattern
                const links = document.querySelectorAll('a[href*="/search/pet?id="]');

                const seen = new Set();

                for (const link of links) {
                    const href = link.href;
                    const petId = href.match(/id=(\d+)/)?.[1];

                    // Skip duplicates
                    if (!petId || seen.has(petId)) continue;
                    seen.add(petId);

                    // Try to extract name from the link text or nearby elements
                    let name = '';

                    // Method 1: Direct text content
                    if (link.textContent && link.textContent.trim() &&
                        !link.textContent.includes('Learn More') &&
                        !link.textContent.includes('View') &&
                        link.textContent.length < 50) {
                        name = link.textContent.trim();
                    }

                    // Method 2: Look for name in aria-label or title
                    if (!name && link.getAttribute('aria-label')) {
                        name = link.getAttribute('aria-label').trim();
                    }

                    if (!name && link.getAttribute('title')) {
                        name = link.getAttribute('title').trim();
                    }

                    // Method 3: Look for nearby heading or name element
                    if (!name) {
                        const parent = link.closest('[class*="card"], [class*="pet"], [class*="result"]');
                        if (parent) {
                            const heading = parent.querySelector('h1, h2, h3, h4, h5, [class*="name"], [class*="title"]');
                            if (heading && heading.textContent && heading.textContent.trim().length < 50) {
                                name = heading.textContent.trim();
                            }
                        }
                    }

                    // Method 4: Look at sibling elements
                    if (!name) {
                        const nextSibling = link.nextElementSibling;
                        if (nextSibling && nextSibling.textContent && nextSibling.textContent.trim().length < 50) {
                            const text = nextSibling.textContent.trim();
                            if (!text.includes('Learn More') && !text.includes('View')) {
                                name = text;
                            }
                        }
                    }

                    // Fallback: Use pet ID if no name found
                    if (!name) {
                        name = `Pet ${petId}`;
                    }

                    // Clean up name: remove age specificity finer than months (weeks, days, etc.)
                    // Examples: "Buddy, 3 weeks" -> "Buddy", "Max, 2 days old" -> "Max"
                    // Keep: "Buddy, 3 months" -> "Buddy, 3 months", "Max, 2 years" -> "Max, 2 years"
                    name = name.replace(/,?\s*\d+\s*(week|day|wk|wks|day|days)s?(\s+old)?/gi, '').trim();

                    results.push({
                        name: name,
                        url: href,
                        id: petId
                    });
                }

                return results;
            });

            // Add new animals to the collection (avoiding duplicates)
            for (const animal of animals) {
                if (!seenIds.has(animal.id)) {
                    seenIds.add(animal.id);
                    allAnimals.push(animal);
                }
            }

            console.error(`[List Scraper] Found ${animals.length} animals on page ${currentPage}`);

            // Check if we've reached the maximum pages
            if (currentPage >= MAX_PAGES) {
                console.error(`[List Scraper] Reached maximum pages (${MAX_PAGES}), stopping`);
                hasMorePages = false;
                break;
            }

            // Check if there's a next page button
            const nextPageButton = await page.evaluate(() => {
                // Look for Wagtopia-style pagination (vue3-pagination component)
                // The pagination has structure: <ul class="Pagination"><li class="PaginationControl">
                // The next button is a PaginationControl with Control-active class when enabled
                const paginationControls = Array.from(document.querySelectorAll('.PaginationControl'));

                // The next button is usually the last PaginationControl element
                // It has a "Control-active" class when enabled
                const nextControl = paginationControls[paginationControls.length - 1];

                if (nextControl) {
                    const svg = nextControl.querySelector('svg.Control-active');
                    if (svg) {
                        return true; // Next button is active
                    }
                }

                // Fallback: Try to find a numbered page button that's higher than current
                const pageButtons = Array.from(document.querySelectorAll('button.Page'));
                const activeButton = pageButtons.find(btn => btn.classList.contains('Page-active'));

                if (activeButton && pageButtons.length > 0) {
                    const currentPageText = activeButton.textContent?.trim();
                    const currentPage = parseInt(currentPageText, 10);

                    // Check if there's a higher page number
                    const hasHigherPage = pageButtons.some(btn => {
                        const pageNum = parseInt(btn.textContent?.trim(), 10);
                        return pageNum > currentPage;
                    });

                    if (hasHigherPage) {
                        return true;
                    }
                }

                return null;
            });

            if (nextPageButton) {
                console.error(`[List Scraper] Next page button found, navigating to page ${currentPage + 1}`);

                // Click the next button
                await page.evaluate(() => {
                    // Method 1: Click the next page number button directly
                    const pageButtons = Array.from(document.querySelectorAll('button.Page'));
                    const activeButton = pageButtons.find(btn => btn.classList.contains('Page-active'));

                    if (activeButton && pageButtons.length > 0) {
                        const currentPageText = activeButton.textContent?.trim();
                        const currentPage = parseInt(currentPageText, 10);

                        // Find and click the button for the next page
                        const nextPageButton = pageButtons.find(btn => {
                            const pageNum = parseInt(btn.textContent?.trim(), 10);
                            return pageNum === currentPage + 1;
                        });

                        if (nextPageButton) {
                            nextPageButton.click();
                            return;
                        }
                    }

                    // Method 2: Click the next arrow (PaginationControl)
                    const paginationControls = Array.from(document.querySelectorAll('.PaginationControl'));
                    const nextControl = paginationControls[paginationControls.length - 1];
                    if (nextControl) {
                        nextControl.click();
                    }
                });

                // Wait for navigation or content to update
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);

                currentPage++;
            } else {
                console.error(`[List Scraper] No more pages found`);
                hasMorePages = false;
            }
        }

        console.error(`[List Scraper] Total animals found across ${currentPage} page(s): ${allAnimals.length}`);

        // Log first few for debugging
        if (allAnimals.length > 0) {
            console.error(`[List Scraper] Sample animals:`, allAnimals.slice(0, 3));
        }

        return allAnimals;

    } catch (error) {
        console.error('[List Scraper] Error:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// CLI interface
if (require.main === module) {
    const url = process.argv[2] || 'https://www.wagtopia.com/search/org?id=1841035&iframe=normal';

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

module.exports = { scrapeAnimalList };
