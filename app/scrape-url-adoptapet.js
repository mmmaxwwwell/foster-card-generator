const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Get the tmp directory in user's data folder
const TMP_DIR = path.join(os.homedir(), '.local', 'share', 'foster-card-generator', 'tmp');

/**
 * Scrapes an Adoptapet animal page and extracts relevant information
 * @param {string} url - The URL to scrape
 * @returns {Promise<Object>} - Scraped animal data
 */
async function scrapeAnimalPage(url) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1920,1080',
            '--start-maximized'
        ]
    });

    try {
        const page = await browser.newPage();

        // Anti-detection: Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Anti-detection: Remove webdriver property
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            // Hide automation indicators
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
        });

        // Set a reasonable viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Set extra HTTP headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });

        // Navigate to the page
        console.error(`[Adoptapet Scraper] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait longer for Cloudflare challenge to resolve
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Extract data from the page
        const data = await page.evaluate(() => {
            const result = {
                name: '',
                breed: '',
                age_long: '',
                age_short: '',
                size: 'Medium',
                gender: 'Male',
                shots: 0,
                housetrained: 0,
                kids: '0',
                dogs: '0',
                cats: '0',
                imageUrl: ''
            };

            // Try to find the viewData JSON object in the page
            // It's embedded in an x-data attribute on the carousel container
            const carouselContainer = document.querySelector('.pet-details-carousel-container');
            if (carouselContainer) {
                const xDataAttr = carouselContainer.getAttribute('x-data');
                if (xDataAttr) {
                    // Extract the viewData JSON from the x-data attribute
                    // Need to find the matching closing brace by counting braces
                    const viewDataStart = xDataAttr.indexOf('viewData:');
                    let viewDataMatch = null;
                    if (viewDataStart !== -1) {
                        const afterViewData = xDataAttr.substring(viewDataStart + 'viewData:'.length).trim();
                        if (afterViewData.startsWith('{')) {
                            let braceCount = 0;
                            let endIndex = -1;
                            for (let i = 0; i < afterViewData.length; i++) {
                                if (afterViewData[i] === '{') braceCount++;
                                else if (afterViewData[i] === '}') {
                                    braceCount--;
                                    if (braceCount === 0) {
                                        endIndex = i;
                                        break;
                                    }
                                }
                            }
                            if (endIndex !== -1) {
                                viewDataMatch = [null, afterViewData.substring(0, endIndex + 1)];
                            }
                        }
                    }
                    if (viewDataMatch) {
                        try {
                            // The JSON is HTML-encoded, so we need to decode it
                            const jsonStr = viewDataMatch[1]
                                .replace(/&quot;/g, '"')
                                .replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&#39;/g, "'")
                                .replace(/&apos;/g, "'");

                            const viewData = JSON.parse(jsonStr);

                            // Extract name
                            result.name = viewData.petName || '';

                            // Extract breed, removing anything in parentheses
                            result.breed = (viewData.petBreed || '').replace(/\s*\([^)]*\)/g, '').trim();

                            // Extract attributes
                            if (viewData.petAttributes) {
                                for (const attr of viewData.petAttributes) {
                                    const label = attr.label?.toLowerCase() || '';
                                    const content = attr.content || '';

                                    if (label === 'age') {
                                        // Parse age like "5 years 5 months old, Adult" or "2 years old, Young"
                                        const yearsMatch = content.match(/(\d+)\s*year/i);
                                        const monthsMatch = content.match(/(\d+)\s*month/i);

                                        if (yearsMatch && parseInt(yearsMatch[1]) >= 1) {
                                            // 1 year or older - show years only
                                            const years = yearsMatch[1];
                                            result.age_long = `${years} Year${years === '1' ? '' : 's'}`;
                                            result.age_short = `${years} Yr`;
                                        } else if (monthsMatch) {
                                            // Under 1 year - show months
                                            const months = monthsMatch[1];
                                            result.age_long = `${months} Month${months === '1' ? '' : 's'}`;
                                            result.age_short = `${months} Mo`;
                                        }
                                    } else if (label === 'size') {
                                        // Parse size like "Large 61-100 lbs..." or "Med. 26-60 lbs..."
                                        const sizeContent = content.toLowerCase();
                                        if (sizeContent.includes('large')) {
                                            result.size = 'Large';
                                        } else if (sizeContent.includes('small')) {
                                            result.size = 'Small';
                                        } else if (sizeContent.includes('med')) {
                                            result.size = 'Medium';
                                        }
                                    } else if (label === 'sex') {
                                        result.gender = content.toLowerCase() === 'female' ? 'Female' : 'Male';
                                    }
                                }
                            }

                            // Extract traits (shots, housetrained, spayed/neutered, good with kids/dogs/cats)
                            if (viewData.petTraits) {
                                for (const trait of viewData.petTraits) {
                                    const type = trait.type?.toLowerCase() || '';
                                    const status = trait.status;

                                    if (type === 'shotscurrent') {
                                        result.shots = status ? 1 : 0;
                                    } else if (type === 'housetrained') {
                                        result.housetrained = status ? 1 : 0;
                                    } else if (type === 'spayedneutered') {
                                        // Update gender based on spayed/neutered status
                                        if (status) {
                                            if (result.gender === 'Male') {
                                                result.gender = 'Neutered(M)';
                                            } else if (result.gender === 'Female') {
                                                result.gender = 'Spayed(F)';
                                            }
                                        }
                                    } else if (type === 'goodwithkids') {
                                        result.kids = status ? '1' : '0';
                                    } else if (type === 'goodwithdogs') {
                                        result.dogs = status ? '1' : '0';
                                    } else if (type === 'goodwithcats') {
                                        result.cats = status ? '1' : '0';
                                    }
                                }
                            }

                            // Extract image URL from petSocialShareData.sharedPhotoUrl
                            if (viewData.petSocialShareData && viewData.petSocialShareData.sharedPhotoUrl) {
                                result.imageUrl = viewData.petSocialShareData.sharedPhotoUrl;
                            } else if (viewData.petThumbnailUrl) {
                                result.imageUrl = viewData.petThumbnailUrl;
                            }
                        } catch (e) {
                            console.error('Error parsing viewData:', e);
                        }
                    }
                }
            }

            // Fallback: Try to get name from h1 if not found in viewData
            if (!result.name) {
                const h1 = document.querySelector('h1');
                if (h1) {
                    // Parse "My name is Dante!" format
                    const nameMatch = h1.textContent.match(/My name is (.+?)!?$/i);
                    if (nameMatch) {
                        result.name = nameMatch[1].trim();
                    } else {
                        result.name = h1.textContent.trim();
                    }
                }
            }

            // Fallback: Try to get image from selected-image if not found
            if (!result.imageUrl) {
                const selectedImage = document.querySelector('.selected-image');
                if (selectedImage && selectedImage.src) {
                    // Convert thumbnail URL to full-size URL
                    result.imageUrl = selectedImage.src
                        .replace(/c_fit,h_\d+,dpr_\d+/, 'c_fit,h_800,dpr_2')
                        .replace(/\/d_PDP-NoPetPhoto_Dog\.png/, '');
                }
            }

            return result;
        });

        console.error('[Adoptapet Scraper] Extracted data:', JSON.stringify(data, null, 2));

        // Download the image if found
        let imagePath = null;
        if (data.imageUrl) {
            try {
                console.error('[Adoptapet Scraper] Downloading image from:', data.imageUrl);

                // Create a new page for downloading the image to avoid affecting the main page
                const imgPage = await browser.newPage();
                const imageResponse = await imgPage.goto(data.imageUrl, {
                    waitUntil: 'networkidle0',
                    timeout: 30000
                });

                if (!imageResponse || !imageResponse.ok()) {
                    throw new Error(`Failed to download image: ${imageResponse?.status()}`);
                }

                const imageBuffer = await imageResponse.buffer();
                await imgPage.close();

                // Determine file extension from URL or content-type
                const contentType = imageResponse.headers()['content-type'] || '';
                let ext = 'jpg';
                if (contentType.includes('png') || data.imageUrl.includes('.png')) {
                    ext = 'png';
                } else if (contentType.includes('gif') || data.imageUrl.includes('.gif')) {
                    ext = 'gif';
                } else if (contentType.includes('webp') || data.imageUrl.includes('.webp')) {
                    ext = 'webp';
                }

                // Save to temporary location
                const timestamp = Date.now();
                imagePath = path.join(TMP_DIR, `scraped-adoptapet-${timestamp}.${ext}`);
                await fs.mkdir(TMP_DIR, { recursive: true });
                await fs.writeFile(imagePath, imageBuffer);
                console.error('[Adoptapet Scraper] Image saved to:', imagePath);
                console.error('[Adoptapet Scraper] Image size:', imageBuffer.length, 'bytes');
            } catch (imgErr) {
                console.error('[Adoptapet Scraper] Error downloading image:', imgErr.message);
            }
        }

        // Return the scraped data
        // Strip the slug suffix after the pet ID (e.g., -middlebury-connecticut-husky)
        const cleanUrl = url.replace(/\/pet\/(\d+)-.*$/, '/pet/$1');
        return {
            ...data,
            imagePath: imagePath,
            slug: cleanUrl
        };

    } catch (error) {
        console.error('[Adoptapet Scraper] Error:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// CLI interface
if (require.main === module) {
    const url = process.argv[2];

    if (!url) {
        console.error('Usage: node scrape-url-adoptapet.js <url>');
        process.exit(1);
    }

    scrapeAnimalPage(url)
        .then(data => {
            // Output as JSON to stdout
            console.log(JSON.stringify(data));
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed:', error.message);
            process.exit(1);
        });
}

module.exports = { scrapeAnimalPage };
