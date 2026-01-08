const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Get the tmp directory in user's data folder
const TMP_DIR = path.join(os.homedir(), '.local', 'share', 'foster-card-generator', 'tmp');

/**
 * Scrapes an animal adoption page and extracts relevant information
 * @param {string} url - The URL to scrape
 * @returns {Promise<Object>} - Scraped animal data
 */
async function scrapeAnimalPage(url) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Set a reasonable viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Navigate to the page
        console.error(`[Scraper] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait a bit for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract data from the page
        const data = await page.evaluate(() => {
            const result = {
                name: '',
                breed: '',
                age_long: '',
                age_short: '',
                size: 'Medium',
                gender: 'Male',
                shots: 1,
                housetrained: 1,
                kids: '?',
                dogs: '?',
                cats: '?',
                imageUrl: ''
            };

            // Helper function to get table cell value by header text
            const getTableValue = (headerText) => {
                const rows = document.querySelectorAll('table tr');
                for (const row of rows) {
                    const header = row.querySelector('th');
                    const cell = row.querySelector('td');
                    if (header && cell && header.textContent.trim().toLowerCase().includes(headerText.toLowerCase())) {
                        return cell.textContent.trim();
                    }
                }
                return null;
            };

            // Helper function to check for keywords in text
            const containsKeyword = (text, keywords) => {
                if (!text) return false;
                const lowerText = text.toLowerCase();
                return keywords.some(kw => lowerText.includes(kw.toLowerCase()));
            };

            // Extract name from table or breadcrumb
            result.name = getTableValue('Name') ||
                         document.querySelector('.breadcrumb-item a[disabled="true"]')?.textContent?.trim() ||
                         document.querySelector('h1')?.textContent?.trim() || '';

            // Extract age
            const ageText = getTableValue('Age');
            if (ageText) {
                // First, remove zero-value units
                let cleanedAge = ageText
                    .replace(/,?\s*0\s+(years?|months?|weeks?|days?)/gi, '')
                    .trim();

                // Check if there's a year component
                const hasYear = /\d+\s*years?/i.test(cleanedAge);
                // Check if there's a month component
                const hasMonth = /\d+\s*months?/i.test(cleanedAge);

                if (hasYear) {
                    // If there's a year, keep only the year part
                    // Remove everything after the year (months, weeks, days, and connecting words)
                    cleanedAge = cleanedAge
                        .replace(/(\d+\s+years?).*$/i, '$1')
                        .trim();
                } else if (hasMonth) {
                    // If there's a month (but no year), keep only the month part
                    // Remove everything after the month (weeks, days, and connecting words)
                    cleanedAge = cleanedAge
                        .replace(/(\d+\s+months?).*$/i, '$1')
                        .trim();
                }
                // If only weeks or days, keep them as-is

                result.age_long = cleanedAge;
                // Parse age for short form
                const ageMatch = cleanedAge.match(/(\d+)\s*(year|month|week)/i);
                if (ageMatch) {
                    const num = ageMatch[1];
                    const unit = ageMatch[2].toLowerCase();
                    if (unit.startsWith('year')) {
                        result.age_short = `${num} Yr`;
                    } else if (unit.startsWith('month')) {
                        result.age_short = `${num} Mo`;
                    } else if (unit.startsWith('week')) {
                        result.age_short = `${num} Wk`;
                    }
                }
            }

            // Extract gender
            const genderText = getTableValue('Gender');
            if (genderText) {
                const spayedNeutered = getTableValue('Spayed / Neutered');
                if (genderText.toLowerCase() === 'male') {
                    result.gender = (spayedNeutered && spayedNeutered.toLowerCase() === 'yes') ? 'Neutered(M)' : 'Male';
                } else if (genderText.toLowerCase() === 'female') {
                    result.gender = (spayedNeutered && spayedNeutered.toLowerCase() === 'yes') ? 'Spayed(F)' : 'Female';
                }
            }

            // Extract size
            const sizeText = getTableValue('Size');
            if (sizeText) {
                if (containsKeyword(sizeText, ['large', 'big'])) {
                    result.size = 'Large';
                } else if (containsKeyword(sizeText, ['small'])) {
                    result.size = 'Small';
                } else if (containsKeyword(sizeText, ['medium'])) {
                    result.size = 'Medium';
                }
            }

            // Extract shots status
            const shotsText = getTableValue('Shots up to date');
            result.shots = (shotsText && shotsText.toLowerCase() === 'yes') ? 1 : 0;

            // Extract housetrained status
            const housetrainedText = getTableValue('Housetrained');
            result.housetrained = (housetrainedText && housetrainedText.toLowerCase() === 'yes') ? 1 : 0;

            // Extract compatibility with kids
            const kidsText = getTableValue('OK with kids');
            if (kidsText) {
                if (kidsText.toLowerCase() === 'yes') result.kids = '1';
                else if (kidsText.toLowerCase() === 'no') result.kids = '0';
                else result.kids = '?';
            }

            // Extract compatibility with dogs
            const dogsText = getTableValue('OK with dogs');
            if (dogsText) {
                if (dogsText.toLowerCase() === 'yes') result.dogs = '1';
                else if (dogsText.toLowerCase() === 'no') result.dogs = '0';
                else result.dogs = '?';
            }

            // Extract compatibility with cats
            const catsText = getTableValue('OK with cats');
            if (catsText) {
                if (catsText.toLowerCase() === 'yes') result.cats = '1';
                else if (catsText.toLowerCase() === 'no') result.cats = '0';
                else result.cats = '?';
            }

            // Extract breed from the page
            // Method 1: Look for h2 with pet-breed class (most reliable)
            const petBreedElement = document.querySelector('h2.pet-breed');
            if (petBreedElement) {
                result.breed = petBreedElement.textContent.trim();
            }

            // Method 2: Look for breed in table
            if (!result.breed) {
                const breedFromTable = getTableValue('Breed');
                if (breedFromTable) {
                    result.breed = breedFromTable;
                }
            }

            // Method 3: Try pet-info basic text or just .basic
            if (!result.breed) {
                const petInfoBasic = document.querySelector('.pet-info .basic') || document.querySelector('.basic');
                if (petInfoBasic) {
                    const basicText = petInfoBasic.textContent.trim();
                    // Parse format like "Male Maltese  Young" or "Male Boxer Terriers (Medium) Young"
                    // Remove gender, size, and age indicators
                    let breed = basicText
                        .replace(/^(Male|Female|Neutered|Spayed)\s+/i, '')
                        .replace(/\s+(Male|Female)\s+/i, ' ')
                        .replace(/\s*\([^)]*\)\s*/g, ' ') // Remove parentheses content
                        .replace(/\s+(Young|Adult|Senior|Puppy|Kitten|Baby)\s*$/i, '')
                        .replace(/\s+/g, ' ') // Normalize multiple spaces
                        .trim();

                    if (breed && breed.length > 0) result.breed = breed;
                }
            }

            // Method 4: Look for breadcrumb or other elements that might contain breed
            if (!result.breed) {
                const breadcrumbItems = document.querySelectorAll('.breadcrumb-item');
                for (const item of breadcrumbItems) {
                    const text = item.textContent.trim();
                    // Breeds are often in breadcrumbs like "Home > Dogs > Labrador Retriever > Max"
                    if (text &&
                        !text.toLowerCase().includes('home') &&
                        !text.toLowerCase().includes('search') &&
                        !text.toLowerCase().includes('dogs') &&
                        !text.toLowerCase().includes('cats') &&
                        text !== result.name) {
                        result.breed = text;
                        break;
                    }
                }
            }

            // Fallback: If still no breed, use "Mixed Breed" as default
            if (!result.breed) {
                result.breed = 'Mixed Breed';
            }

            // Try to find the main image
            // Look for the main pet photo (not thumbnails in carousel)
            const galleryImage = document.querySelector('.pet-photo[data-src]:not(.thumbnail)');
            if (galleryImage) {
                const dataSrc = galleryImage.getAttribute('data-src');
                if (dataSrc && dataSrc.startsWith('http')) {
                    result.imageUrl = dataSrc;
                }
            }

            if (!result.imageUrl) {
                const possibleImages = Array.from(document.querySelectorAll('img'));
                const validImages = possibleImages.filter(img => {
                    const src = img.src || '';
                    const width = img.naturalWidth || img.width || 0;
                    const height = img.naturalHeight || img.height || 0;

                    return width > 200 &&
                           height > 200 &&
                           !src.includes('logo') &&
                           !src.includes('icon') &&
                           !src.includes('loading.gif');
                });

                if (validImages.length > 0) {
                    validImages.sort((a, b) => {
                        const aSize = (a.naturalWidth || a.width) * (a.naturalHeight || a.height);
                        const bSize = (b.naturalWidth || b.width) * (b.naturalHeight || b.height);
                        return bSize - aSize;
                    });
                    result.imageUrl = validImages[0].src;
                }
            }

            return result;
        });

        console.error('[Scraper] Extracted data:', JSON.stringify(data, null, 2));

        // Download the image if found
        let imagePath = null;
        if (data.imageUrl) {
            try {
                console.error('[Scraper] Downloading image from:', data.imageUrl);

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
                imagePath = path.join(TMP_DIR, `scraped-${timestamp}.${ext}`);
                await fs.mkdir(TMP_DIR, { recursive: true });
                await fs.writeFile(imagePath, imageBuffer);
                console.error('[Scraper] Image saved to:', imagePath);
                console.error('[Scraper] Image size:', imageBuffer.length, 'bytes');
            } catch (imgErr) {
                console.error('[Scraper] Error downloading image:', imgErr.message);
            }
        }

        // Return the scraped data
        return {
            ...data,
            imagePath: imagePath,
            slug: url
        };

    } catch (error) {
        console.error('[Scraper] Error:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// CLI interface
if (require.main === module) {
    const url = process.argv[2];

    if (!url) {
        console.error('Usage: node scrape-url.js <url>');
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
