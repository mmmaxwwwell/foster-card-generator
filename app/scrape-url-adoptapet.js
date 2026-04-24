const { getTmpDir } = require('./paths.js');
const fs = require('fs').promises;
const path = require('path');

const TMP_DIR = getTmpDir();

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extractFlightPayload(html) {
    // Match self.__next_f.push([1, "..."]) — capture the JSON string literal body
    // The string may span many characters including escaped quotes, so grab greedily up to "])
    const regex = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
    const parts = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        try {
            const decoded = JSON.parse('"' + match[1] + '"');
            parts.push(decoded);
        } catch (e) {
            // Skip chunks that fail to parse
        }
    }
    return parts.join('');
}

function findPetDetailsObject(payload) {
    const marker = '"__typename":"PetDetails"';
    const markerIdx = payload.indexOf(marker);
    if (markerIdx === -1) return null;

    // Forward-scan the payload tracking string state and a stack of unmatched `{` positions.
    // When we pass the marker, the top of the stack is the enclosing object's opening brace.
    // Then keep scanning until the stack pops back to that level — that's the closing `}`.
    const stack = [];
    let enclosingStart = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < payload.length; i++) {
        const ch = payload[i];
        if (inString) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') {
            stack.push(i);
        } else if (ch === '}') {
            const openedAt = stack.pop();
            if (enclosingStart !== -1 && openedAt === enclosingStart) {
                const slice = payload.substring(enclosingStart, i + 1);
                try { return JSON.parse(slice); } catch (e) { return null; }
            }
        }
        if (enclosingStart === -1 && i >= markerIdx) {
            if (stack.length === 0) return null;
            enclosingStart = stack[stack.length - 1];
        }
    }
    return null;
}

/**
 * Scrapes an Adoptapet animal page and extracts relevant information.
 * @param {string} url - The URL to scrape
 * @returns {Promise<Object>} - Scraped animal data
 */
async function scrapeAnimalPage(url) {
    const warnings = [];
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
        imageUrl: '',
        bio: '',
        photoUrls: []
    };

    console.error(`[Adoptapet Scraper] Fetching: ${url}`);
    const res = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
    }

    const html = await res.text();

    const payload = extractFlightPayload(html);
    if (!payload) {
        warnings.push('No __next_f chunks were found');
    }

    const viewData = payload ? findPetDetailsObject(payload) : null;
    if (!viewData) {
        warnings.push('PetDetails object could not be located');
    }

    if (viewData) {
        result.name = viewData.petName || '';
        result.breed = (viewData.petBreed || '').replace(/\s*\([^)]*\)/g, '').trim();
        result.bio = viewData.petStory || '';

        let ageFound = false;
        if (Array.isArray(viewData.petAttributes)) {
            for (const attr of viewData.petAttributes) {
                const label = (attr.label || '').toLowerCase();
                const content = attr.content || '';

                if (label === 'age') {
                    const yearsMatch = content.match(/(\d+)\s*year/i);
                    const monthsMatch = content.match(/(\d+)\s*month/i);
                    if (yearsMatch && parseInt(yearsMatch[1]) >= 1) {
                        const years = yearsMatch[1];
                        result.age_long = `${years} Year${years === '1' ? '' : 's'}`;
                        result.age_short = `${years} Yr`;
                        ageFound = true;
                    } else if (monthsMatch) {
                        const months = monthsMatch[1];
                        result.age_long = `${months} Month${months === '1' ? '' : 's'}`;
                        result.age_short = `${months} Mo`;
                        ageFound = true;
                    }
                } else if (label === 'size') {
                    const sizeContent = content.toLowerCase();
                    if (sizeContent.includes('large')) result.size = 'Large';
                    else if (sizeContent.includes('small')) result.size = 'Small';
                    else if (sizeContent.includes('med')) result.size = 'Medium';
                } else if (label === 'sex') {
                    result.gender = content.toLowerCase() === 'female' ? 'Female' : 'Male';
                }
            }
        }
        if (!ageFound) {
            warnings.push('No age-producing petAttributes entry was found');
        }

        // Traits are split across two arrays: petTraits (behavior) and petHealthTraits
        // (shots, spay/neuter status). Walk both with the same logic.
        const allTraits = [
            ...(Array.isArray(viewData.petTraits) ? viewData.petTraits : []),
            ...(Array.isArray(viewData.petHealthTraits) ? viewData.petHealthTraits : [])
        ];
        for (const trait of allTraits) {
            const type = (trait.type || '').toLowerCase();
            const status = trait.status;
            if (type === 'shotscurrent') result.shots = status ? 1 : 0;
            else if (type === 'housetrained') result.housetrained = status ? 1 : 0;
            else if (type === 'spayedneutered') {
                if (status) {
                    if (result.gender === 'Male') result.gender = 'Neutered(M)';
                    else if (result.gender === 'Female') result.gender = 'Spayed(F)';
                }
            } else if (type === 'goodwithkids') result.kids = status ? '1' : '0';
            else if (type === 'goodwithdogs') result.dogs = status ? '1' : '0';
            else if (type === 'goodwithcats') result.cats = status ? '1' : '0';
        }

        if (Array.isArray(viewData.petPhotos)) {
            for (const photo of viewData.petPhotos) {
                if (photo.sourcePhotoId) {
                    result.photoUrls.push(`https://media.adoptapet.com/image/upload/c_fit,h_800,dpr_2/f_auto,q_auto/${photo.sourcePhotoId}`);
                }
            }
        }

        if (viewData.petSocialShareData && viewData.petSocialShareData.sharedPhotoUrl) {
            result.imageUrl = viewData.petSocialShareData.sharedPhotoUrl;
        } else if (viewData.petThumbnailUrl) {
            result.imageUrl = viewData.petThumbnailUrl;
        } else if (result.photoUrls.length > 0) {
            result.imageUrl = result.photoUrls[0];
        }

        if (!result.name) warnings.push('petName missing');
        if (!result.breed) warnings.push('petBreed missing');
        if (result.photoUrls.length === 0) warnings.push('petPhotos missing or empty');
    }

    console.error('[Adoptapet Scraper] Extracted data:', JSON.stringify({ ...result, warnings }, null, 2));

    let imagePath = null;
    if (result.imageUrl) {
        try {
            console.error('[Adoptapet Scraper] Downloading image from:', result.imageUrl);
            const imgRes = await fetch(result.imageUrl);
            if (!imgRes.ok) {
                throw new Error(`HTTP ${imgRes.status}`);
            }
            const buf = Buffer.from(await imgRes.arrayBuffer());

            const contentType = imgRes.headers.get('content-type') || '';
            let ext = 'jpg';
            if (contentType.includes('png') || result.imageUrl.includes('.png')) ext = 'png';
            else if (contentType.includes('gif') || result.imageUrl.includes('.gif')) ext = 'gif';
            else if (contentType.includes('webp') || result.imageUrl.includes('.webp')) ext = 'webp';

            await fs.mkdir(TMP_DIR, { recursive: true });
            imagePath = path.join(TMP_DIR, `scraped-adoptapet-${Date.now()}.${ext}`);
            await fs.writeFile(imagePath, buf);
            console.error('[Adoptapet Scraper] Image saved to:', imagePath);
            console.error('[Adoptapet Scraper] Image size:', buf.length, 'bytes');
        } catch (imgErr) {
            console.error('[Adoptapet Scraper] Error downloading image:', imgErr.message);
        }
    }

    const attributes = [];
    if (result.breed) attributes.push(result.breed);
    if (result.age_long) attributes.push(result.age_long);
    if (result.size) attributes.push(result.size);
    if (result.gender) attributes.push(result.gender);
    if (result.shots) attributes.push('Up to date on shots');
    if (result.housetrained) attributes.push('Housetrained');
    if (result.kids === '1') attributes.push('Good with kids');
    if (result.dogs === '1') attributes.push('Good with dogs');
    if (result.cats === '1') attributes.push('Good with cats');

    const cleanUrl = url.replace(/\/pet\/(\d+)-.*$/, '/pet/$1');
    return {
        ...result,
        imagePath,
        slug: cleanUrl,
        attributes,
        photoUrls: result.photoUrls || [],
        warnings
    };
}

if (require.main === module) {
    const url = process.argv[2];
    if (!url) {
        console.error('Usage: node scrape-url-adoptapet.js <url>');
        process.exit(1);
    }
    scrapeAnimalPage(url)
        .then(data => {
            console.log(JSON.stringify(data));
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed:', error.message);
            process.exit(1);
        });
}

module.exports = { scrapeAnimalPage };
