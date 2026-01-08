// Logging system - write to user's home directory
let LOG_DIR = './.tmp';
let LOG_FILE = './.tmp/app.log';
const logMessages = [];

async function writeToLogFile(message) {
    try {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;

        // Try to append to the log file
        let content = '';
        try {
            content = await Neutralino.filesystem.readFile(LOG_FILE);
        } catch (e) {
            // File doesn't exist yet
        }

        await Neutralino.filesystem.writeFile(LOG_FILE, content + logLine);
    } catch (err) {
        // Silently fail - can't do much if logging fails
    }
}

function log(...args) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    // Store in memory with timestamp
    const timestamp = new Date().toISOString();
    logMessages.push(`[${timestamp}] ${message}`);

    // Try to write to file
    writeToLogFile(message);

    // Also log to console
    console.log(...args);
}

// Function to open log file in system editor
async function openLogFile() {
    try {
        log('[App] Opening log file:', LOG_FILE);

        // Try to open with default text editor
        await Neutralino.os.execCommand(`xdg-open "${LOG_FILE}"`, {});
        showToast('Opening log file...');
    } catch (err) {
        console.error('[App] Failed to open log file:', err);

        // Fallback: show logs in alert
        const recentLogs = logMessages.slice(-50).join('\n');
        alert('Log file location: ' + LOG_FILE + '\n\nRecent logs:\n\n' + recentLogs);
    }
}

// Database path - use HOME directory for user data
let DB_DIR = '../db';
let DB_PATH = '../db/animals.db';

// Setup paths for installed version
async function setupPaths() {
    log('[App] ========== STARTING PATH SETUP ==========');

    // Log ALL Neutralino global variables
    const allGlobals = {
        NL_PATH: typeof NL_PATH !== 'undefined' ? NL_PATH : 'UNDEFINED',
        NL_APPID: typeof NL_APPID !== 'undefined' ? NL_APPID : 'UNDEFINED',
        NL_MODE: typeof NL_MODE !== 'undefined' ? NL_MODE : 'UNDEFINED',
        NL_CWD: typeof NL_CWD !== 'undefined' ? NL_CWD : 'UNDEFINED'
    };
    log('[App] Neutralino globals:', JSON.stringify(allGlobals, null, 2));

    try {
        // Get home directory
        log('[App] Executing command to get HOME...');
        const homeResult = await Neutralino.os.execCommand('echo "$HOME/.local/share/foster-card-generator"', {});
        log('[App] Home command exit code:', homeResult.exitCode);
        log('[App] Home command stdout:', homeResult.stdOut);
        log('[App] Home command stderr:', homeResult.stdErr);

        if (homeResult.exitCode === 0) {
            const userDataDir = homeResult.stdOut.trim();
            log('[App] User data directory (trimmed):', userDataDir);

            // Always use user data directory when installed
            // Check multiple indicators
            const nlPathCheck = typeof NL_PATH !== 'undefined' ? NL_PATH : '';
            const isNixInstalled = nlPathCheck.includes('/nix/store/');

            log('[App] NL_PATH value:', nlPathCheck);
            log('[App] Is from Nix store:', isNixInstalled);

            // ALWAYS use user directory if it's not a relative path starting with .
            const shouldUseUserDir = isNixInstalled || !nlPathCheck.startsWith('.');
            log('[App] Should use user directory:', shouldUseUserDir);

            if (shouldUseUserDir && userDataDir && userDataDir.length > 0) {
                log('[App] ===== UPDATING PATHS TO USER DIRECTORY =====');

                const oldDbPath = DB_PATH;
                const oldLogFile = LOG_FILE;

                DB_DIR = userDataDir;
                DB_PATH = `${userDataDir}/animals.db`;
                LOG_DIR = userDataDir;
                LOG_FILE = `${userDataDir}/app.log`;

                log('[App] OLD DB_PATH:', oldDbPath);
                log('[App] NEW DB_PATH:', DB_PATH);
                log('[App] OLD LOG_FILE:', oldLogFile);
                log('[App] NEW LOG_FILE:', LOG_FILE);

                // Verify the assignment worked
                log('[App] VERIFICATION - DB_PATH is now:', DB_PATH);
                log('[App] VERIFICATION - DB_PATH type:', typeof DB_PATH);
                log('[App] VERIFICATION - DB_PATH length:', DB_PATH.length);

                // Create the directory
                log('[App] Creating directory:', userDataDir);
                const mkdirResult = await Neutralino.os.execCommand(`mkdir -p "${userDataDir}"`, {});
                log('[App] mkdir exit code:', mkdirResult.exitCode);
                log('[App] mkdir stdout:', mkdirResult.stdOut);
                log('[App] mkdir stderr:', mkdirResult.stdErr);

                // Show user where files are
                const subtitle = document.getElementById('subtitle');
                log('[App] Looking for subtitle element...');
                if (subtitle) {
                    log('[App] Found subtitle element, updating text');
                    subtitle.textContent = `Data directory: ${userDataDir}`;
                    subtitle.style.fontSize = '12px';
                    subtitle.style.color = '#fff';
                } else {
                    log('[App] WARNING: subtitle element not found!');
                }

                // Show log path in footer
                const logPathEl = document.getElementById('log-path');
                if (logPathEl) {
                    logPathEl.innerHTML = `
                        <strong>📁 Debug Information</strong><br>
                        <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
                            <strong>Database:</strong><br>
                            <code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; font-size: 11px;">${DB_PATH}</code><br><br>
                            <strong>Log file:</strong><br>
                            <code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; font-size: 11px;">${LOG_FILE}</code><br><br>
                            <small style="opacity: 0.8;">To view logs in terminal: <code>tail -f ${LOG_FILE}</code></small>
                        </div>
                    `;
                    log('[App] Updated footer with paths');
                } else {
                    log('[App] WARNING: log-path element not found!');
                }
            } else {
                log('[App] Using development paths (no update needed)');
            }
        } else {
            log('[App] ERROR: Home command failed with exit code:', homeResult.exitCode);
        }
    } catch (err) {
        log('[App] EXCEPTION in setupPaths:', err.message);
        log('[App] Error name:', err.name);
        log('[App] Error stack:', err.stack || 'No stack');
    }

    log('[App] ========== FINAL PATHS ==========');
    log('[App] DB_PATH:', DB_PATH);
    log('[App] DB_DIR:', DB_DIR);
    log('[App] LOG_FILE:', LOG_FILE);
    log('[App] LOG_DIR:', LOG_DIR);
    log('[App] =====================================');
}

let animals = [];
let currentAnimal = null;
let pendingImageData = null; // Stores new image data before save
let newAnimalImageData = null; // Stores image data for new animal

// Check if database exists and initialize if needed
async function initializeDatabase() {
    try {
        console.log('[App] Checking if database exists...');

        // Try to query the animals table to see if it exists
        const result = await Neutralino.os.execCommand(
            `sqlite3 "${DB_PATH}" "SELECT name FROM sqlite_master WHERE type='table' AND name='animals';"`,
            { cwd: NL_PATH }
        );

        if (result.exitCode !== 0 || !result.stdOut.trim()) {
            console.log('[App] Database or animals table not found. Initializing...');

            // Create the animals table schema
            const schema = `
                CREATE TABLE IF NOT EXISTS animals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    size TEXT NOT NULL,
                    shots INTEGER NOT NULL DEFAULT 0,
                    housetrained INTEGER NOT NULL DEFAULT 0,
                    breed TEXT NOT NULL,
                    age_long TEXT NOT NULL,
                    age_short TEXT NOT NULL,
                    gender TEXT NOT NULL,
                    kids TEXT NOT NULL DEFAULT '?',
                    dogs TEXT NOT NULL DEFAULT '?',
                    cats TEXT NOT NULL DEFAULT '?',
                    portrait_path TEXT,
                    portrait_data BLOB,
                    portrait_mime TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_animals_name ON animals(name);

                CREATE TRIGGER IF NOT EXISTS update_animals_timestamp
                AFTER UPDATE ON animals
                BEGIN
                    UPDATE animals SET updated_at = datetime('now') WHERE id = NEW.id;
                END;
            `;

            // Write schema to temp file and execute
            const tmpFile = `./.tmp/init-schema.sql`;
            await Neutralino.filesystem.writeFile(tmpFile, schema);

            const initResult = await Neutralino.os.execCommand(
                `sqlite3 "${DB_PATH}" < "${tmpFile}"`,
                { cwd: NL_PATH }
            );

            // Clean up temp file
            try {
                await Neutralino.filesystem.removeFile(tmpFile);
            } catch (cleanupErr) {
                console.warn('[App] Could not delete temp schema file:', cleanupErr);
            }

            if (initResult.exitCode !== 0) {
                throw new Error('Failed to initialize database: ' + initResult.stdErr);
            }

            console.log('[App] Database initialized successfully (no data seeded)');
            return true; // Database was created
        } else {
            console.log('[App] Database already exists');
            return false; // Database already existed
        }
    } catch (err) {
        console.error('[App] Error initializing database:', err);
        throw err;
    }
}

async function runSQL(sql) {
    try {
        // Use stdin to avoid command line length limits with large image data
        // Create a temporary file with the SQL
        const tmpFile = `./.tmp/sql-${Date.now()}.sql`;
        await Neutralino.filesystem.writeFile(tmpFile, sql);

        const result = await Neutralino.os.execCommand(
            `sqlite3 "${DB_PATH}" < "${tmpFile}"`,
            { cwd: NL_PATH }
        );

        // Clean up temp file
        try {
            await Neutralino.filesystem.removeFile(tmpFile);
        } catch (cleanupErr) {
            console.warn('[App] Could not delete temp SQL file:', cleanupErr);
        }

        if (result.exitCode !== 0) {
            throw new Error(result.stdErr || 'Database query failed');
        }

        return result.stdOut;
    } catch (err) {
        console.error('Database error:', err);
        throw err;
    }
}

async function queryDatabase(sql) {
    try {
        const result = await Neutralino.os.execCommand(
            `sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`,
            { cwd: NL_PATH }
        );

        if (result.exitCode !== 0) {
            throw new Error(result.stdErr || 'Database query failed');
        }

        if (!result.stdOut.trim()) {
            return [];
        }

        return JSON.parse(result.stdOut);
    } catch (err) {
        console.error('Database error:', err);
        throw err;
    }
}

async function getImageAsDataUrl(animalId) {
    try {
        const result = await Neutralino.os.execCommand(
            `sqlite3 "${DB_PATH}" "SELECT portrait_mime, hex(portrait_data) FROM animals WHERE id = ${animalId};"`,
            { cwd: NL_PATH }
        );

        if (result.exitCode !== 0 || !result.stdOut.trim()) {
            return null;
        }

        const [mime, hexData] = result.stdOut.trim().split('|');
        if (!mime || !hexData) return null;

        // Convert hex to base64 in chunks to avoid call stack overflow
        let binary = '';
        for (let i = 0; i < hexData.length; i += 2) {
            const byte = parseInt(hexData.substr(i, 2), 16);
            binary += String.fromCharCode(byte);
        }
        const base64 = btoa(binary);

        return `data:${mime};base64,${base64}`;
    } catch (err) {
        console.error('Error loading image:', err);
        return null;
    }
}

function formatCompatibility(value) {
    if (value === '1' || value === 1 || value === true) {
        return { text: 'Yes', class: 'compat-yes' };
    }
    if (value === '0' || value === 0 || value === false) {
        return { text: 'No', class: 'compat-no' };
    }
    return { text: '?', class: 'compat-unknown' };
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

function escapeSQL(str) {
    if (str === null || str === undefined) return 'NULL';
    return String(str).replace(/'/g, "''");
}

function renderAnimalCard(animal) {
    const kids = formatCompatibility(animal.kids);
    const dogs = formatCompatibility(animal.dogs);
    const cats = formatCompatibility(animal.cats);

    return `
        <div class="animal-card" data-id="${animal.id}">
            <div class="animal-image-container" onclick="openEditModal(${animal.id})">
                ${animal.imageDataUrl
                    ? `<img class="animal-image" src="${animal.imageDataUrl}" alt="${animal.name}">`
                    : `<div class="no-image">🐕</div>`
                }
            </div>
            <div class="animal-info">
                <div onclick="openEditModal(${animal.id})" style="cursor: pointer;">
                    <h2 class="animal-name">${animal.name}</h2>
                    <p class="animal-breed">${animal.breed}</p>
                    <div class="animal-details">
                        <div class="detail">
                            <span class="detail-label">Age:</span>
                            <span class="detail-value">${animal.age_long}</span>
                        </div>
                        <div class="detail">
                            <span class="detail-label">Size:</span>
                            <span class="detail-value">${animal.size}</span>
                        </div>
                        <div class="detail">
                            <span class="detail-label">Gender:</span>
                            <span class="detail-value">${animal.gender}</span>
                        </div>
                        <div class="detail">
                            <span class="detail-label">Shots:</span>
                            <span class="detail-value">${animal.shots ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                    <div class="compatibility">
                        <span class="compat-badge ${kids.class}">Kids: ${kids.text}</span>
                        <span class="compat-badge ${dogs.class}">Dogs: ${dogs.text}</span>
                        <span class="compat-badge ${cats.class}">Cats: ${cats.text}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn-generate-cards" onclick="event.stopPropagation(); generateCards(${animal.id})">Generate Cards</button>
                </div>
            </div>
        </div>
    `;
}

async function loadAnimals() {
    const content = document.getElementById('content');
    const subtitle = document.getElementById('subtitle');

    content.innerHTML = '<div class="loading">Loading animals...</div>';

    try {
        const sql = `SELECT id, name, slug, size, shots, housetrained, breed,
                     age_long, age_short, gender, kids, dogs, cats,
                     portrait_path, portrait_mime FROM animals ORDER BY name`;

        animals = await queryDatabase(sql);

        if (animals.length === 0) {
            content.innerHTML = '<div class="loading">No animals found. Run the migration first.</div>';
            subtitle.textContent = 'No animals in database';
            return;
        }

        subtitle.textContent = `${animals.length} animals available for adoption`;

        // Load images for each animal
        for (const animal of animals) {
            animal.imageDataUrl = await getImageAsDataUrl(animal.id);
        }

        // Render all cards
        content.innerHTML = `
            <div class="animals-grid">
                ${animals.map(renderAnimalCard).join('')}
            </div>
        `;

    } catch (err) {
        console.error('Error loading animals:', err);
        content.innerHTML = `
            <div class="error">
                <h3>Error loading animals</h3>
                <p>${err.message}</p>
                <p>Make sure sqlite3 is available and the database exists.</p>
            </div>
        `;
        subtitle.textContent = 'Error loading data';
    }
}

// Create Animal Modal functions
function openCreateModal() {
    document.getElementById('createModal').classList.add('active');
}

function closeCreateModal() {
    document.getElementById('createModal').classList.remove('active');
}

function selectCreateOption(option) {
    closeCreateModal();

    if (option === 'manual') {
        openManualEntryModal();
    } else if (option === 'scrape') {
        openScrapeModal();
    } else if (option === 'selectFromSite') {
        openSelectFromSiteModal();
    }
}

// Scrape Modal functions
function openScrapeModal() {
    document.getElementById('scrapeModal').classList.add('active');
    document.getElementById('scrapeUrl').value = '';
}

function closeScrapeModal() {
    document.getElementById('scrapeModal').classList.remove('active');
}

async function scrapeUrl() {
    const url = document.getElementById('scrapeUrl').value.trim();

    if (!url) {
        showToast('Please enter a URL', 'error');
        return;
    }

    try {
        showToast('Scraping data from URL...', 'success');
        console.log('[App] Starting scrape for URL:', url);

        // Call the scraper script
        const command = `node scrape-url.js "${url.replace(/"/g, '\\"')}"`;
        console.log('[App] Executing scraper command');

        const result = await Neutralino.os.execCommand(command, { cwd: NL_PATH });

        console.log('[App] Scraper exit code:', result.exitCode);

        // Log stderr (debug messages from scraper)
        if (result.stdErr) {
            const lines = result.stdErr.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    console.log('[Scraper]', line);
                }
            }
        }

        if (result.exitCode !== 0) {
            throw new Error(result.stdErr || 'Scraping failed');
        }

        // Parse the scraped data from stdout
        const scrapedData = JSON.parse(result.stdOut.trim());
        console.log('[App] Scraped data:', scrapedData);

        // Close scrape modal
        closeScrapeModal();

        // Load image if available
        if (scrapedData.imagePath) {
            try {
                // Convert relative path to absolute path (relative to NL_PATH)
                const imagePath = scrapedData.imagePath.startsWith('/')
                    ? scrapedData.imagePath
                    : `${NL_PATH}/${scrapedData.imagePath}`;
                console.log('[App] Loading scraped image from:', imagePath);

                // Read the image file
                const data = await Neutralino.filesystem.readBinaryFile(imagePath);

                // Determine MIME type
                const ext = imagePath.split('.').pop().toLowerCase();
                const mimeTypes = {
                    'jpg': 'image/jpeg',
                    'jpeg': 'image/jpeg',
                    'png': 'image/png',
                    'gif': 'image/gif',
                    'webp': 'image/webp'
                };
                const mime = mimeTypes[ext] || 'image/jpeg';

                // Convert to hex for database
                const uint8Array = new Uint8Array(data);
                let hexString = '';
                for (let i = 0; i < uint8Array.length; i++) {
                    hexString += uint8Array[i].toString(16).padStart(2, '0');
                }

                // Store image data
                newAnimalImageData = {
                    hex: hexString,
                    mime: mime,
                    path: imagePath.split('/').pop()
                };

                // Convert to base64 for preview
                let binary = '';
                for (let i = 0; i < uint8Array.length; i++) {
                    binary += String.fromCharCode(uint8Array[i]);
                }
                const base64 = btoa(binary);
                scrapedData.imageDataUrl = `data:${mime};base64,${base64}`;

                console.log('[App] Image loaded successfully');
            } catch (imgErr) {
                console.error('[App] Error loading scraped image:', imgErr);
                console.error('[App] Error details:', imgErr.message, imgErr.stack);
                showToast('Warning: Could not load scraped image', 'error');
            }
        }

        // Open manual entry modal with pre-populated data
        openManualEntryModalWithData(scrapedData);

        showToast('Data scraped successfully!', 'success');

    } catch (err) {
        console.error('[App] Error scraping URL:', err);
        showToast(`Error scraping URL: ${err.message}`, 'error');
    }
}

function openManualEntryModalWithData(data) {
    // Store the image data before opening modal (which resets it)
    const savedImageData = newAnimalImageData;

    openManualEntryModal();

    // Restore the image data that was reset by openManualEntryModal
    if (savedImageData) {
        newAnimalImageData = savedImageData;
    }

    // Populate form fields with scraped data
    if (data.name) document.getElementById('newName').value = data.name;
    if (data.breed) document.getElementById('newBreed').value = data.breed;
    if (data.slug) document.getElementById('newSlug').value = data.slug;
    if (data.age_long) document.getElementById('newAgeLong').value = data.age_long;
    if (data.age_short) document.getElementById('newAgeShort').value = data.age_short;
    if (data.size) document.getElementById('newSize').value = data.size;
    if (data.gender) document.getElementById('newGender').value = data.gender;
    if (data.shots !== undefined) document.getElementById('newShots').value = data.shots;
    if (data.housetrained !== undefined) document.getElementById('newHousetrained').value = data.housetrained;
    if (data.kids !== undefined) document.getElementById('newKids').value = data.kids;
    if (data.dogs !== undefined) document.getElementById('newDogs').value = data.dogs;
    if (data.cats !== undefined) document.getElementById('newCats').value = data.cats;

    // Update image preview if available
    if (data.imageDataUrl) {
        const imageContainer = document.querySelector('#manualEntryModal .modal-image-container');
        let modalImage = document.getElementById('newAnimalImage');
        const modalNoImage = document.getElementById('newAnimalNoImage');

        if (!modalImage) {
            modalImage = document.createElement('img');
            modalImage.id = 'newAnimalImage';
            modalImage.className = 'modal-image';
            imageContainer.insertBefore(modalImage, imageContainer.firstChild);
        }

        modalImage.src = data.imageDataUrl;
        modalImage.style.display = 'block';
        modalNoImage.style.display = 'none';
    }
}

// Manual Entry Modal functions
function openManualEntryModal() {
    newAnimalImageData = null; // Reset image data
    document.getElementById('manualEntryModal').classList.add('active');

    // Reset form
    document.getElementById('createForm').reset();

    // Reset image display
    const modalImage = document.getElementById('newAnimalImage');
    const modalNoImage = document.getElementById('newAnimalNoImage');
    if (modalImage) {
        modalImage.style.display = 'none';
    }
    modalNoImage.style.display = 'flex';
}

function closeManualEntryModal() {
    document.getElementById('manualEntryModal').classList.remove('active');
    newAnimalImageData = null;
}

async function handleNewAnimalImageSelected(event) {
    const file = event.target.files[0];
    if (!file) {
        console.log('No file selected');
        return;
    }

    console.log('File selected:', file.name, 'Size:', file.size, 'Type:', file.type);

    try {
        // Read file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Convert to hex string for SQLite
        let hexString = '';
        for (let i = 0; i < uint8Array.length; i++) {
            hexString += uint8Array[i].toString(16).padStart(2, '0');
        }

        // Store new animal image data
        newAnimalImageData = {
            hex: hexString,
            mime: file.type || 'image/jpeg',
            path: file.name
        };

        // Convert to base64 for preview
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:${file.type};base64,${base64}`;

        // Update preview - create img element if it doesn't exist
        const imageContainer = document.querySelector('#manualEntryModal .modal-image-container');
        let modalImage = document.getElementById('newAnimalImage');
        const modalNoImage = document.getElementById('newAnimalNoImage');

        if (!modalImage) {
            modalImage = document.createElement('img');
            modalImage.id = 'newAnimalImage';
            modalImage.className = 'modal-image';
            imageContainer.insertBefore(modalImage, imageContainer.firstChild);
        }

        modalImage.src = dataUrl;
        modalImage.style.display = 'block';
        modalNoImage.style.display = 'none';

        showToast('Image selected. Click Create to save animal.');
    } catch (err) {
        console.error('Error loading image:', err);
        showToast('Error loading image: ' + err.message, 'error');
    }
}

async function loadNewAnimalImage(filePath) {
    try {
        // Read the file as binary
        const data = await Neutralino.filesystem.readBinaryFile(filePath);

        // Determine MIME type from extension
        const ext = filePath.split('.').pop().toLowerCase();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp'
        };
        const mime = mimeTypes[ext] || 'image/jpeg';

        // Convert ArrayBuffer to hex string for SQLite
        const uint8Array = new Uint8Array(data);
        let hexString = '';
        for (let i = 0; i < uint8Array.length; i++) {
            hexString += uint8Array[i].toString(16).padStart(2, '0');
        }

        // Store new animal image data
        newAnimalImageData = {
            hex: hexString,
            mime: mime,
            path: filePath.split('/').pop()
        };

        // Convert to base64 for preview
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:${mime};base64,${base64}`;

        // Update preview - create img element if it doesn't exist
        const imageContainer = document.querySelector('#manualEntryModal .modal-image-container');
        let modalImage = document.getElementById('newAnimalImage');
        const modalNoImage = document.getElementById('newAnimalNoImage');

        if (!modalImage) {
            modalImage = document.createElement('img');
            modalImage.id = 'newAnimalImage';
            modalImage.className = 'modal-image';
            imageContainer.insertBefore(modalImage, imageContainer.firstChild);
        }

        modalImage.src = dataUrl;
        modalImage.style.display = 'block';
        modalNoImage.style.display = 'none';

        showToast('Image selected. Click Create to save animal.');
    } catch (err) {
        console.error('Error loading image:', err);
        showToast('Error loading image: ' + err.message, 'error');
    }
}

async function createAnimal() {
    const name = escapeSQL(document.getElementById('newName').value);
    const breed = escapeSQL(document.getElementById('newBreed').value);
    const slug = escapeSQL(document.getElementById('newSlug').value);
    const ageLong = escapeSQL(document.getElementById('newAgeLong').value);
    const ageShort = escapeSQL(document.getElementById('newAgeShort').value);
    const size = escapeSQL(document.getElementById('newSize').value);
    const gender = escapeSQL(document.getElementById('newGender').value);
    const shots = document.getElementById('newShots').value;
    const housetrained = document.getElementById('newHousetrained').value;
    const kids = escapeSQL(document.getElementById('newKids').value);
    const dogs = escapeSQL(document.getElementById('newDogs').value);
    const cats = escapeSQL(document.getElementById('newCats').value);

    // Build SQL with optional image data
    let sql;
    if (newAnimalImageData) {
        sql = `INSERT INTO animals (
            name, breed, slug, age_long, age_short, size, gender, shots, housetrained,
            kids, dogs, cats, portrait_path, portrait_mime, portrait_data
        ) VALUES (
            '${name}', '${breed}', '${slug}', '${ageLong}', '${ageShort}',
            '${size}', '${gender}', ${shots}, ${housetrained},
            '${kids}', '${dogs}', '${cats}',
            '${escapeSQL(newAnimalImageData.path)}',
            '${escapeSQL(newAnimalImageData.mime)}',
            X'${newAnimalImageData.hex}'
        );`;
    } else {
        sql = `INSERT INTO animals (
            name, breed, slug, age_long, age_short, size, gender, shots, housetrained,
            kids, dogs, cats
        ) VALUES (
            '${name}', '${breed}', '${slug}', '${ageLong}', '${ageShort}',
            '${size}', '${gender}', ${shots}, ${housetrained},
            '${kids}', '${dogs}', '${cats}'
        );`;
    }

    try {
        console.log('[App] Creating animal with image data:', newAnimalImageData ? 'Yes' : 'No');
        if (newAnimalImageData) {
            console.log('[App] Image data size:', newAnimalImageData.hex.length / 2, 'bytes');
        }
        await runSQL(sql);
        showToast(`${document.getElementById('newName').value} created successfully!`);
        closeManualEntryModal();
        await loadAnimals();
    } catch (err) {
        console.error('[App] Error creating animal:', err);
        console.error('[App] SQL length:', sql.length);
        showToast(`Error creating animal: ${err.message}`, 'error');
    }
}

// Modal functions
function openEditModal(animalId) {
    currentAnimal = animals.find(a => a.id === animalId);
    if (!currentAnimal) return;

    pendingImageData = null; // Reset pending image

    document.getElementById('editModal').classList.add('active');

    // Set image
    const modalImage = document.getElementById('modalImage');
    const modalNoImage = document.getElementById('modalNoImage');
    if (currentAnimal.imageDataUrl) {
        modalImage.src = currentAnimal.imageDataUrl;
        modalImage.style.display = 'block';
        modalNoImage.style.display = 'none';
    } else {
        modalImage.style.display = 'none';
        modalNoImage.style.display = 'flex';
    }

    // Fill form fields
    document.getElementById('animalId').value = currentAnimal.id;
    document.getElementById('name').value = currentAnimal.name || '';
    document.getElementById('breed').value = currentAnimal.breed || '';
    document.getElementById('slug').value = currentAnimal.slug || '';
    document.getElementById('ageLong').value = currentAnimal.age_long || '';
    document.getElementById('ageShort').value = currentAnimal.age_short || '';
    document.getElementById('size').value = currentAnimal.size || 'Medium';
    document.getElementById('gender').value = currentAnimal.gender || 'Male';
    document.getElementById('shots').value = currentAnimal.shots ? '1' : '0';
    document.getElementById('housetrained').value = currentAnimal.housetrained ? '1' : '0';

    // Handle compatibility fields (can be 1, 0, or ?)
    const kidsVal = String(currentAnimal.kids);
    document.getElementById('kids').value = kidsVal === '1' ? '1' : kidsVal === '0' ? '0' : '?';

    const dogsVal = String(currentAnimal.dogs);
    document.getElementById('dogs').value = dogsVal === '1' ? '1' : dogsVal === '0' ? '0' : '?';

    const catsVal = String(currentAnimal.cats);
    document.getElementById('cats').value = catsVal === '1' ? '1' : catsVal === '0' ? '0' : '?';
}

function closeModal() {
    document.getElementById('editModal').classList.remove('active');
    currentAnimal = null;
    pendingImageData = null;
}

// Image change functionality
async function handleEditImageSelected(event) {
    if (!currentAnimal) return;

    const file = event.target.files[0];
    if (!file) {
        console.log('No file selected');
        return;
    }

    console.log('File selected:', file.name, 'Size:', file.size, 'Type:', file.type);

    try {
        // Read file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Convert to hex string for SQLite
        let hexString = '';
        for (let i = 0; i < uint8Array.length; i++) {
            hexString += uint8Array[i].toString(16).padStart(2, '0');
        }

        // Store pending image data
        pendingImageData = {
            hex: hexString,
            mime: file.type || 'image/jpeg',
            path: file.name
        };

        // Convert to base64 for preview
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:${file.type};base64,${base64}`;

        // Update preview
        const modalImage = document.getElementById('modalImage');
        const modalNoImage = document.getElementById('modalNoImage');
        modalImage.src = dataUrl;
        modalImage.style.display = 'block';
        modalNoImage.style.display = 'none';

        showToast('Image selected. Click Save to apply changes.');
    } catch (err) {
        console.error('Error loading image:', err);
        showToast('Error loading image: ' + err.message, 'error');
    }
}

async function loadNewImage(filePath) {
    try {
        // Read the file as binary
        const data = await Neutralino.filesystem.readBinaryFile(filePath);

        // Determine MIME type from extension
        const ext = filePath.split('.').pop().toLowerCase();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp'
        };
        const mime = mimeTypes[ext] || 'image/jpeg';

        // Convert ArrayBuffer to hex string for SQLite
        const uint8Array = new Uint8Array(data);
        let hexString = '';
        for (let i = 0; i < uint8Array.length; i++) {
            hexString += uint8Array[i].toString(16).padStart(2, '0');
        }

        // Store pending image data
        pendingImageData = {
            hex: hexString,
            mime: mime,
            path: filePath.split('/').pop()
        };

        // Convert to base64 for preview
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:${mime};base64,${base64}`;

        // Update preview
        const modalImage = document.getElementById('modalImage');
        const modalNoImage = document.getElementById('modalNoImage');
        modalImage.src = dataUrl;
        modalImage.style.display = 'block';
        modalNoImage.style.display = 'none';

        showToast('Image selected. Click Save to apply changes.');
    } catch (err) {
        console.error('Error loading image:', err);
        showToast('Error loading image: ' + err.message, 'error');
    }
}

async function saveAnimal() {
    if (!currentAnimal) return;

    const id = document.getElementById('animalId').value;
    const name = escapeSQL(document.getElementById('name').value);
    const breed = escapeSQL(document.getElementById('breed').value);
    const slug = escapeSQL(document.getElementById('slug').value);
    const ageLong = escapeSQL(document.getElementById('ageLong').value);
    const ageShort = escapeSQL(document.getElementById('ageShort').value);
    const size = escapeSQL(document.getElementById('size').value);
    const gender = escapeSQL(document.getElementById('gender').value);
    const shots = document.getElementById('shots').value;
    const housetrained = document.getElementById('housetrained').value;
    const kids = escapeSQL(document.getElementById('kids').value);
    const dogs = escapeSQL(document.getElementById('dogs').value);
    const cats = escapeSQL(document.getElementById('cats').value);

    // Build SQL with optional image update
    let sql;
    if (pendingImageData) {
        sql = `UPDATE animals SET
            name = '${name}',
            breed = '${breed}',
            slug = '${slug}',
            age_long = '${ageLong}',
            age_short = '${ageShort}',
            size = '${size}',
            gender = '${gender}',
            shots = ${shots},
            housetrained = ${housetrained},
            kids = '${kids}',
            dogs = '${dogs}',
            cats = '${cats}',
            portrait_path = '${escapeSQL(pendingImageData.path)}',
            portrait_mime = '${escapeSQL(pendingImageData.mime)}',
            portrait_data = X'${pendingImageData.hex}'
            WHERE id = ${id};`;
    } else {
        sql = `UPDATE animals SET
            name = '${name}',
            breed = '${breed}',
            slug = '${slug}',
            age_long = '${ageLong}',
            age_short = '${ageShort}',
            size = '${size}',
            gender = '${gender}',
            shots = ${shots},
            housetrained = ${housetrained},
            kids = '${kids}',
            dogs = '${dogs}',
            cats = '${cats}'
            WHERE id = ${id};`;
    }

    try {
        await runSQL(sql);
        showToast(`${document.getElementById('name').value} updated successfully!`);
        closeModal();
        await loadAnimals();
    } catch (err) {
        showToast(`Error saving: ${err.message}`, 'error');
    }
}

async function deleteAnimal() {
    if (!currentAnimal) return;

    const name = currentAnimal.name;
    const confirmed = confirm(`Are you sure you want to delete ${name}? This cannot be undone.`);

    if (!confirmed) return;

    const sql = `DELETE FROM animals WHERE id = ${currentAnimal.id};`;

    try {
        await runSQL(sql);
        showToast(`${name} deleted successfully!`);
        closeModal();
        await loadAnimals();
    } catch (err) {
        showToast(`Error deleting: ${err.message}`, 'error');
    }
}

// Print Multiple Modal functions
let selectedPrintAnimalIds = new Set();

function openPrintMultipleModal() {
    document.getElementById('printMultipleModal').classList.add('active');
    selectedPrintAnimalIds.clear();
    renderPrintAnimalGrid();
}

function closePrintMultipleModal() {
    document.getElementById('printMultipleModal').classList.remove('active');
    selectedPrintAnimalIds.clear();
}

function renderPrintAnimalGrid() {
    const grid = document.getElementById('printAnimalGrid');
    const printButton = document.getElementById('printButton');
    const selectAllCheckbox = document.getElementById('printSelectAllCheckbox');

    if (animals.length === 0) {
        grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No animals to print.</div>';
        printButton.disabled = true;
        return;
    }

    let html = '';
    for (const animal of animals) {
        const isSelected = selectedPrintAnimalIds.has(animal.id);
        html += `
            <div class="delete-animal-item ${isSelected ? 'selected' : ''}" onclick="togglePrintAnimal(${animal.id})">
                <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); togglePrintAnimal(${animal.id})">
                ${animal.imageDataUrl
                    ? `<img class="delete-animal-thumbnail" src="${animal.imageDataUrl}" alt="${animal.name}">`
                    : `<div class="delete-animal-no-image">🐕</div>`
                }
                <div class="delete-animal-name">${animal.name}</div>
            </div>
        `;
    }

    grid.innerHTML = html;

    // Update select all checkbox state
    selectAllCheckbox.checked = selectedPrintAnimalIds.size === animals.length && animals.length > 0;

    updatePrintButton();
}

function togglePrintAnimal(animalId) {
    if (selectedPrintAnimalIds.has(animalId)) {
        selectedPrintAnimalIds.delete(animalId);
    } else {
        selectedPrintAnimalIds.add(animalId);
    }
    renderPrintAnimalGrid();
}

function togglePrintSelectAll() {
    const selectAllCheckbox = document.getElementById('printSelectAllCheckbox');

    if (selectAllCheckbox.checked) {
        // Select all
        for (const animal of animals) {
            selectedPrintAnimalIds.add(animal.id);
        }
    } else {
        // Deselect all
        selectedPrintAnimalIds.clear();
    }

    renderPrintAnimalGrid();
}

function updatePrintButton() {
    const printButton = document.getElementById('printButton');
    const count = selectedPrintAnimalIds.size;

    if (count > 0) {
        printButton.disabled = false;
        printButton.textContent = `Print Selected (${count})`;
    } else {
        printButton.disabled = true;
        printButton.textContent = 'Print Selected';
    }
}

async function printSelectedAnimals() {
    if (selectedPrintAnimalIds.size === 0) {
        showToast('Please select at least one animal to print', 'error');
        return;
    }

    const count = selectedPrintAnimalIds.size;
    const animalNames = animals
        .filter(a => selectedPrintAnimalIds.has(a.id))
        .map(a => a.name)
        .slice(0, 3)
        .join(', ');

    const displayNames = count > 3 ? `${animalNames} and ${count - 3} more` : animalNames;

    const confirmed = confirm(
        `Generate cards for ${count} animal${count > 1 ? 's' : ''}?\n\n${displayNames}\n\nCards will be added to the print queue.`
    );

    if (!confirmed) return;

    // Add all selected animals to the generation queue
    const idsToGenerate = Array.from(selectedPrintAnimalIds);
    for (const animalId of idsToGenerate) {
        const animal = animals.find(a => a.id === animalId);
        if (animal) {
            cardGenerationQueue.push({ animalId });
            console.log('[Queue] Added', animal.name, 'to queue. Queue length:', cardGenerationQueue.length);
        }
    }

    showToast(`Added ${count} animal${count > 1 ? 's' : ''} to generation queue`, 'success');

    // Close modal
    closePrintMultipleModal();

    // Start processing the queue
    processCardGenerationQueue();
}

// Close modal on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        closeCreateModal();
        closeManualEntryModal();
        closeScrapeModal();
        closeSelectFromSiteModal();
        closeDeleteMultipleModal();
        closePrintMultipleModal();
    }
});

// Close modal when clicking outside
document.getElementById('createModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeCreateModal();
    }
});

document.getElementById('manualEntryModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeManualEntryModal();
    }
});

document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal();
    }
});

document.getElementById('scrapeModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeScrapeModal();
    }
});

document.getElementById('selectFromSiteModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeSelectFromSiteModal();
    }
});

document.getElementById('deleteMultipleModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeDeleteMultipleModal();
    }
});

document.getElementById('printMultipleModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closePrintMultipleModal();
    }
});

// Delete Multiple Modal functions
let selectedDeleteAnimalIds = new Set();

function openDeleteMultipleModal() {
    document.getElementById('deleteMultipleModal').classList.add('active');
    selectedDeleteAnimalIds.clear();
    renderDeleteAnimalGrid();
}

function closeDeleteMultipleModal() {
    document.getElementById('deleteMultipleModal').classList.remove('active');
    selectedDeleteAnimalIds.clear();
}

function renderDeleteAnimalGrid() {
    const grid = document.getElementById('deleteAnimalGrid');
    const deleteButton = document.getElementById('deleteButton');
    const selectAllCheckbox = document.getElementById('deleteSelectAllCheckbox');

    if (animals.length === 0) {
        grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No animals to delete.</div>';
        deleteButton.disabled = true;
        return;
    }

    let html = '';
    for (const animal of animals) {
        const isSelected = selectedDeleteAnimalIds.has(animal.id);
        html += `
            <div class="delete-animal-item ${isSelected ? 'selected' : ''}" onclick="toggleDeleteAnimal(${animal.id})">
                <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleDeleteAnimal(${animal.id})">
                ${animal.imageDataUrl
                    ? `<img class="delete-animal-thumbnail" src="${animal.imageDataUrl}" alt="${animal.name}">`
                    : `<div class="delete-animal-no-image">🐕</div>`
                }
                <div class="delete-animal-name">${animal.name}</div>
            </div>
        `;
    }

    grid.innerHTML = html;

    // Update select all checkbox state
    selectAllCheckbox.checked = selectedDeleteAnimalIds.size === animals.length && animals.length > 0;

    updateDeleteButton();
}

function toggleDeleteAnimal(animalId) {
    if (selectedDeleteAnimalIds.has(animalId)) {
        selectedDeleteAnimalIds.delete(animalId);
    } else {
        selectedDeleteAnimalIds.add(animalId);
    }
    renderDeleteAnimalGrid();
}

function toggleDeleteSelectAll() {
    const selectAllCheckbox = document.getElementById('deleteSelectAllCheckbox');

    if (selectAllCheckbox.checked) {
        // Select all
        for (const animal of animals) {
            selectedDeleteAnimalIds.add(animal.id);
        }
    } else {
        // Deselect all
        selectedDeleteAnimalIds.clear();
    }

    renderDeleteAnimalGrid();
}

function updateDeleteButton() {
    const deleteButton = document.getElementById('deleteButton');
    const count = selectedDeleteAnimalIds.size;

    if (count > 0) {
        deleteButton.disabled = false;
        deleteButton.textContent = `Delete Selected (${count})`;
    } else {
        deleteButton.disabled = true;
        deleteButton.textContent = 'Delete Selected';
    }
}

async function deleteSelectedAnimals() {
    if (selectedDeleteAnimalIds.size === 0) {
        showToast('Please select at least one animal to delete', 'error');
        return;
    }

    const count = selectedDeleteAnimalIds.size;
    const animalNames = animals
        .filter(a => selectedDeleteAnimalIds.has(a.id))
        .map(a => a.name)
        .slice(0, 3)
        .join(', ');

    const displayNames = count > 3 ? `${animalNames} and ${count - 3} more` : animalNames;

    const confirmed = confirm(
        `Are you sure you want to delete ${count} animal${count > 1 ? 's' : ''}?\n\n${displayNames}\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    const deleteButton = document.getElementById('deleteButton');
    const grid = document.getElementById('deleteAnimalGrid');

    // Disable button during deletion
    deleteButton.disabled = true;
    const originalText = deleteButton.textContent;

    try {
        grid.innerHTML = '<div class="loading-spinner">Deleting animals...</div>';

        const idsToDelete = Array.from(selectedDeleteAnimalIds);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < idsToDelete.length; i++) {
            const animalId = idsToDelete[i];
            const animal = animals.find(a => a.id === animalId);
            const animalName = animal ? animal.name : `ID ${animalId}`;

            deleteButton.textContent = `Deleting ${i + 1}/${idsToDelete.length}...`;

            try {
                const sql = `DELETE FROM animals WHERE id = ${animalId};`;
                await runSQL(sql);
                console.log(`[App] Deleted animal: ${animalName}`);
                successCount++;
            } catch (err) {
                console.error(`[App] Error deleting ${animalName}:`, err);
                failCount++;
            }
        }

        // Show summary
        let message = `Deleted ${successCount} animal${successCount !== 1 ? 's' : ''}`;
        if (failCount > 0) {
            message += `, ${failCount} failed`;
        }
        showToast(message, failCount > 0 ? 'error' : 'success');

        // Close modal and refresh animal list
        closeDeleteMultipleModal();
        await loadAnimals();

    } catch (err) {
        console.error('[App] Error during deletion:', err);
        showToast(`Error deleting animals: ${err.message}`, 'error');
        renderDeleteAnimalGrid();
    } finally {
        deleteButton.disabled = false;
        deleteButton.textContent = originalText;
    }
}

// Select from Site Modal functions
let scrapedAnimals = [];
let selectedAnimalUrls = new Set();

async function openSelectFromSiteModal() {
    document.getElementById('selectFromSiteModal').classList.add('active');
    scrapedAnimals = [];
    selectedAnimalUrls.clear();

    const container = document.getElementById('animalListContainer');
    const importButton = document.getElementById('importButton');

    container.innerHTML = '<div class="loading-spinner">Loading animals from Wagtopia</div>';
    importButton.disabled = true;

    try {
        // Call the scraper script to get the list of animals
        const url = 'https://www.wagtopia.com/search/org?id=1841035';
        const command = `node scrape-list.js "${url.replace(/"/g, '\\"')}"`;
        console.log('[App] Executing list scraper command');

        const result = await Neutralino.os.execCommand(command, { cwd: NL_PATH });

        console.log('[App] List scraper exit code:', result.exitCode);

        // Log stderr (debug messages from scraper)
        if (result.stdErr) {
            const lines = result.stdErr.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    console.log('[List Scraper]', line);
                }
            }
        }

        if (result.exitCode !== 0) {
            throw new Error(result.stdErr || 'List scraping failed');
        }

        // Parse the scraped list from stdout
        scrapedAnimals = JSON.parse(result.stdOut.trim());
        console.log('[App] Scraped', scrapedAnimals.length, 'animals');

        if (scrapedAnimals.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No animals found on the page.</div>';
            return;
        }

        // Render the animal selection list
        renderAnimalSelectionList();

    } catch (err) {
        console.error('[App] Error loading animal list:', err);
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #dc3545;">Error loading animals: ${err.message}</div>`;
    }
}

function closeSelectFromSiteModal() {
    document.getElementById('selectFromSiteModal').classList.remove('active');
    scrapedAnimals = [];
    selectedAnimalUrls.clear();
}

function renderAnimalSelectionList() {
    const container = document.getElementById('animalListContainer');
    const importButton = document.getElementById('importButton');

    // Save scroll position before re-rendering
    const listElement = container.querySelector('.animal-select-list');
    const scrollTop = listElement ? listElement.scrollTop : 0;

    let html = '<div class="select-all-container">';
    html += '<label><input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll()"> Select All</label>';
    html += '</div>';
    html += '<div class="animal-select-list">';

    for (const animal of scrapedAnimals) {
        const isSelected = selectedAnimalUrls.has(animal.url);
        html += `<div class="animal-select-item ${isSelected ? 'selected' : ''}" onclick="toggleAnimalSelection('${animal.url}')">`;
        html += `<input type="checkbox" ${isSelected ? 'checked' : ''} onchange="event.stopPropagation(); toggleAnimalSelection('${animal.url}')">`;
        html += `<label>${animal.name}</label>`;
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Restore scroll position after re-rendering
    const newListElement = container.querySelector('.animal-select-list');
    if (newListElement && scrollTop > 0) {
        newListElement.scrollTop = scrollTop;
    }

    updateImportButton();
}

function toggleAnimalSelection(url) {
    if (selectedAnimalUrls.has(url)) {
        selectedAnimalUrls.delete(url);
    } else {
        selectedAnimalUrls.add(url);
    }

    renderAnimalSelectionList();
}

function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    if (selectAllCheckbox.checked) {
        // Select all
        for (const animal of scrapedAnimals) {
            selectedAnimalUrls.add(animal.url);
        }
    } else {
        // Deselect all
        selectedAnimalUrls.clear();
    }

    renderAnimalSelectionList();
}

function updateImportButton() {
    const importButton = document.getElementById('importButton');
    const count = selectedAnimalUrls.size;

    if (count > 0) {
        importButton.disabled = false;
        importButton.textContent = `Import Selected (${count})`;
    } else {
        importButton.disabled = true;
        importButton.textContent = 'Import Selected';
    }
}

async function importSelectedAnimals() {
    if (selectedAnimalUrls.size === 0) {
        showToast('Please select at least one animal', 'error');
        return;
    }

    const importButton = document.getElementById('importButton');
    const container = document.getElementById('animalListContainer');

    // Disable the button during import
    importButton.disabled = true;
    const originalText = importButton.textContent;

    const urlsToImport = Array.from(selectedAnimalUrls);
    let successCount = 0;
    let failCount = 0;

    try {
        container.innerHTML = '<div class="loading-spinner">Importing animals...</div>';

        for (let i = 0; i < urlsToImport.length; i++) {
            const url = urlsToImport[i];
            const animalName = scrapedAnimals.find(a => a.url === url)?.name || 'Unknown';

            importButton.textContent = `Importing ${i + 1}/${urlsToImport.length}: ${animalName}`;
            console.log(`[App] Importing ${i + 1}/${urlsToImport.length}: ${animalName}`);

            try {
                // Call the scraper script
                const command = `node scrape-url.js "${url.replace(/"/g, '\\"')}"`;
                const result = await Neutralino.os.execCommand(command, { cwd: NL_PATH });

                if (result.exitCode !== 0) {
                    throw new Error(result.stdErr || 'Scraping failed');
                }

                // Parse the scraped data from stdout
                const scrapedData = JSON.parse(result.stdOut.trim());
                console.log('[App] Scraped data for:', scrapedData.name);

                // Load image if available
                let imageData = null;
                if (scrapedData.imagePath) {
                    try {
                        const imagePath = scrapedData.imagePath.startsWith('/')
                            ? scrapedData.imagePath
                            : `${NL_PATH}/${scrapedData.imagePath}`;

                        const data = await Neutralino.filesystem.readBinaryFile(imagePath);
                        const ext = imagePath.split('.').pop().toLowerCase();
                        const mimeTypes = {
                            'jpg': 'image/jpeg',
                            'jpeg': 'image/jpeg',
                            'png': 'image/png',
                            'gif': 'image/gif',
                            'webp': 'image/webp'
                        };
                        const mime = mimeTypes[ext] || 'image/jpeg';

                        const uint8Array = new Uint8Array(data);
                        let hexString = '';
                        for (let j = 0; j < uint8Array.length; j++) {
                            hexString += uint8Array[j].toString(16).padStart(2, '0');
                        }

                        imageData = {
                            hex: hexString,
                            mime: mime,
                            path: imagePath.split('/').pop()
                        };
                    } catch (imgErr) {
                        console.error('[App] Error loading image:', imgErr);
                    }
                }

                // Insert into database
                let sql;
                if (imageData) {
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
                        '${escapeSQL(imageData.path)}',
                        '${escapeSQL(imageData.mime)}',
                        X'${imageData.hex}'
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

                await runSQL(sql);
                console.log('[App] Successfully imported:', scrapedData.name);
                successCount++;

                // Clean up temporary image file
                if (scrapedData.imagePath) {
                    try {
                        await Neutralino.os.execCommand(`rm "${scrapedData.imagePath}"`, { cwd: NL_PATH });
                    } catch (cleanupErr) {
                        console.error('[App] Error cleaning up temp file:', cleanupErr);
                    }
                }

            } catch (err) {
                console.error(`[App] Error importing ${animalName}:`, err);
                failCount++;
            }
        }

        // Show summary
        let message = `Import complete: ${successCount} succeeded`;
        if (failCount > 0) {
            message += `, ${failCount} failed`;
        }
        showToast(message, failCount > 0 ? 'error' : 'success');

        // Close modal and refresh animal list
        closeSelectFromSiteModal();
        await loadAnimals();

    } catch (err) {
        console.error('[App] Error during import:', err);
        showToast(`Error importing animals: ${err.message}`, 'error');
    } finally {
        importButton.disabled = false;
        importButton.textContent = originalText;
    }
}

// Note: Click handlers for image containers are now inline in HTML

// Initialize app
Neutralino.init();

Neutralino.events.on('ready', async () => {
    log('========== Neutralino app ready ==========');

    // Setup paths first (this updates DB_PATH and LOG_FILE)
    await setupPaths();

    // Initialize database if needed
    try {
        await initializeDatabase();
    } catch (err) {
        console.error('[App] Failed to initialize database:', err);
        const content = document.getElementById('content');
        if (content) {
            content.innerHTML = `
                <div class="error">
                    <h3>Database Initialization Failed</h3>
                    <p>${err.message}</p>
                    <p>Please ensure sqlite3 is installed and accessible.</p>
                </div>
            `;
        }
        return;
    }

    // Load animals after initialization
    await loadAnimals();
});

Neutralino.events.on('windowClose', () => {
    Neutralino.app.exit();
});

// Card generation queue
let cardGenerationQueue = [];
let isProcessingQueue = false;

async function processCardGenerationQueue() {
    if (isProcessingQueue || cardGenerationQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;

    while (cardGenerationQueue.length > 0) {
        const task = cardGenerationQueue.shift();
        const animal = animals.find(a => a.id === task.animalId);

        if (!animal) {
            console.error('[Queue] Animal not found:', task.animalId);
            continue;
        }

        try {
            console.log('[Queue] Processing card generation for:', animal.name);
            showToast(`Generating cards for ${animal.name}... (${cardGenerationQueue.length} in queue)`);

            // Generate front card first
            await printCardFront(task.animalId);

            // Then generate back card
            await printCardBack(task.animalId);

            showToast(`Cards generated for ${animal.name}!`);
        } catch (err) {
            console.error('[Queue] Error generating cards for', animal.name, ':', err);
            showToast(`Error generating cards for ${animal.name}: ${err.message}`, 'error');
        }
    }

    isProcessingQueue = false;
    console.log('[Queue] Queue processing complete');
}

// Generate cards function
async function generateCards(animalId) {
    const animal = animals.find(a => a.id === animalId);
    if (!animal) {
        showToast('Animal not found', 'error');
        return;
    }

    // Add to queue
    cardGenerationQueue.push({ animalId });
    console.log('[Queue] Added', animal.name, 'to queue. Queue length:', cardGenerationQueue.length);

    showToast(`${animal.name} added to generation queue (position ${cardGenerationQueue.length})`);

    // Start processing the queue
    processCardGenerationQueue();
}

// Print card functions
async function printCardFront(animalId) {
    const animal = animals.find(a => a.id === animalId);
    if (!animal) {
        showToast('Animal not found', 'error');
        return;
    }

    let tempImagePath = null;

    try {
        showToast(`Generating card front for ${animal.name}...`);
        console.log('[App] Starting card generation for animal:', animal.name);

        // Write portrait data to temporary file if available
        let portraitFilePath = null;
        if (animal.imageDataUrl) {
            // Extract base64 data from data URL
            const base64Match = animal.imageDataUrl.match(/base64,(.+)/);
            if (base64Match) {
                const portraitData = base64Match[1];
                console.log('[App] Portrait data extracted, length:', portraitData.length);

                // Write to temporary file
                tempImagePath = `./.tmp/portrait-${animal.id}-${Date.now()}.jpg`;
                console.log('[App] Writing portrait to temp file:', tempImagePath);

                // Convert base64 to binary buffer
                const binaryString = atob(portraitData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                await Neutralino.filesystem.writeBinaryFile(tempImagePath, bytes);
                console.log('[App] Portrait written to temp file');
                portraitFilePath = tempImagePath;
            } else {
                console.log('[App] No base64 match in imageDataUrl');
            }
        } else {
            console.log('[App] No imageDataUrl available');
        }

        // Prepare parameters for card generation
        const params = {
            name: animal.name,
            breed: animal.breed,
            ageShort: animal.age_short,
            ageLong: animal.age_long,
            size: animal.size,
            gender: animal.gender,
            shots: animal.shots,
            housetrained: animal.housetrained,
            kids: animal.kids,
            dogs: animal.dogs,
            cats: animal.cats,
            slug: animal.slug,
            portraitPath: animal.portrait_path || 'portrait.jpg',
            portraitFilePath: portraitFilePath
        };

        console.log('[App] Parameters prepared:', JSON.stringify({...params}));

        // Call the card generation script
        const jsonParams = JSON.stringify(params);
        const command = `node generate-card-cli.js '${jsonParams.replace(/'/g, "\\'")}' `;
        console.log('[App] Executing command:', command.substring(0, 200) + '...');

        const result = await Neutralino.os.execCommand(command, { cwd: NL_PATH });

        console.log('[App] Command exit code:', result.exitCode);

        // Log stderr (debug messages)
        if (result.stdErr) {
            const lines = result.stdErr.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    console.log('[CardGen Debug]', line);
                }
            }
        }

        if (result.exitCode !== 0) {
            throw new Error(result.stdErr || 'Card generation failed');
        }

        // The output path is in stdout
        const outputPath = result.stdOut.trim();
        console.log('[App] Card generated at:', outputPath);

        // Clean up temporary file
        if (tempImagePath) {
            try {
                await Neutralino.os.execCommand(`rm "${tempImagePath}"`, { cwd: NL_PATH });
                console.log('[App] Cleaned up temp file:', tempImagePath);
            } catch (cleanupErr) {
                console.error('[App] Error cleaning up temp file:', cleanupErr);
            }
        }

        // Open in GIMP (don't wait for it to exit)
        console.log('[App] Opening GIMP...');
        Neutralino.os.execCommand(`gimp "${outputPath}" &`, { cwd: NL_PATH }).catch(err => {
            console.error('[App] Error launching GIMP:', err);
        });
        console.log('[App] GIMP launched');

        showToast(`Card front generated for ${animal.name}!`);
    } catch (err) {
        console.error('[App] Error printing card front:', err);
        console.error('[App] Error stack:', err.stack);
        showToast(`Error generating card: ${err.message}`, 'error');

        // Clean up temporary file on error
        if (tempImagePath) {
            try {
                await Neutralino.os.execCommand(`rm "${tempImagePath}"`, { cwd: NL_PATH });
                console.log('[App] Cleaned up temp file after error:', tempImagePath);
            } catch (cleanupErr) {
                console.error('[App] Error cleaning up temp file after error:', cleanupErr);
            }
        }
    }
}

async function printCardBack(animalId) {
    const animal = animals.find(a => a.id === animalId);
    if (!animal) {
        showToast('Animal not found', 'error');
        return;
    }

    let tempImagePath = null;

    try {
        showToast(`Generating card back for ${animal.name}...`);
        console.log('[App] Starting card back generation for animal:', animal.name);

        // Write portrait data to temporary file if available
        let portraitFilePath = null;
        if (animal.imageDataUrl) {
            // Extract base64 data from data URL
            const base64Match = animal.imageDataUrl.match(/base64,(.+)/);
            if (base64Match) {
                const portraitData = base64Match[1];
                console.log('[App] Portrait data extracted, length:', portraitData.length);

                // Write to temporary file
                tempImagePath = `./.tmp/portrait-${animal.id}-${Date.now()}.jpg`;
                console.log('[App] Writing portrait to temp file:', tempImagePath);

                // Convert base64 to binary buffer
                const binaryString = atob(portraitData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                await Neutralino.filesystem.writeBinaryFile(tempImagePath, bytes);
                console.log('[App] Portrait written to temp file');
                portraitFilePath = tempImagePath;
            } else {
                console.log('[App] No base64 match in imageDataUrl');
            }
        } else {
            console.log('[App] No imageDataUrl available');
        }

        // Prepare parameters for card generation
        const params = {
            name: animal.name,
            breed: animal.breed,
            ageShort: animal.age_short,
            ageLong: animal.age_long,
            size: animal.size,
            gender: animal.gender,
            shots: animal.shots,
            housetrained: animal.housetrained,
            kids: animal.kids,
            dogs: animal.dogs,
            cats: animal.cats,
            slug: animal.slug,
            portraitPath: animal.portrait_path || 'portrait.jpg',
            portraitFilePath: portraitFilePath
        };

        console.log('[App] Parameters prepared:', JSON.stringify({...params}));

        // Call the card generation script with 'back' parameter
        const jsonParams = JSON.stringify(params);
        const command = `node generate-card-cli.js '${jsonParams.replace(/'/g, "\\'")}' back`;
        console.log('[App] Executing command:', command.substring(0, 200) + '...');

        const result = await Neutralino.os.execCommand(command, { cwd: NL_PATH });

        console.log('[App] Command exit code:', result.exitCode);

        // Log stderr (debug messages)
        if (result.stdErr) {
            const lines = result.stdErr.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    console.log('[CardGen Debug]', line);
                }
            }
        }

        if (result.exitCode !== 0) {
            throw new Error(result.stdErr || 'Card generation failed');
        }

        // The output path is in stdout
        const outputPath = result.stdOut.trim();
        console.log('[App] Card generated at:', outputPath);

        // Clean up temporary file
        if (tempImagePath) {
            try {
                await Neutralino.os.execCommand(`rm "${tempImagePath}"`, { cwd: NL_PATH });
                console.log('[App] Cleaned up temp file:', tempImagePath);
            } catch (cleanupErr) {
                console.error('[App] Error cleaning up temp file:', cleanupErr);
            }
        }

        // Open in GIMP (don't wait for it to exit)
        console.log('[App] Opening GIMP...');
        Neutralino.os.execCommand(`gimp "${outputPath}" &`, { cwd: NL_PATH }).catch(err => {
            console.error('[App] Error launching GIMP:', err);
        });
        console.log('[App] GIMP launched');

        showToast(`Card back generated for ${animal.name}!`);
    } catch (err) {
        console.error('[App] Error printing card back:', err);
        console.error('[App] Error stack:', err.stack);
        showToast(`Error generating card: ${err.message}`, 'error');

        // Clean up temporary file on error
        if (tempImagePath) {
            try {
                await Neutralino.os.execCommand(`rm "${tempImagePath}"`, { cwd: NL_PATH });
                console.log('[App] Cleaned up temp file after error:', tempImagePath);
            } catch (cleanupErr) {
                console.error('[App] Error cleaning up temp file after error:', cleanupErr);
            }
        }
    }
}
