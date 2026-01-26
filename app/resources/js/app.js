// Logging system - declare early to avoid TDZ issues if requires fail
const logMessages = [];
let loggingReady = false;
let LOG_DIR = null;
let LOG_FILE = null;
let TMP_DIR = null;

// Node.js modules for Electron
const fs = require('fs');
const path = require('path');

// Database module
const db = require('../db.js');

// Import card generation functions directly (no need to spawn subprocess)
let generateCardFront = null;
let generateCardBack = null;
try {
    const cardGen = require('../generate-card-cli.js');
    console.log('[App] cardGen module loaded:', cardGen);
    console.log('[App] cardGen keys:', Object.keys(cardGen));
    console.log('[App] generateCardBack type:', typeof cardGen.generateCardBack);
    generateCardFront = cardGen.generateCardFront;
    generateCardBack = cardGen.generateCardBack;
} catch (err) {
    console.error('[App] Failed to load card generation module:', err.message);
    console.error('[App] Full error:', err);
    console.error('[App] Stack:', err.stack);
}

// Use IPC to call scraper in main process (puppeteer doesn't work well in renderer)
const { ipcRenderer } = require('electron');

// Current selected rescue target
let selectedRescue = 'wagtopia'; // 'wagtopia' or 'adoptapet'

async function scrapeAnimalPageWagtopia(url) {
    const result = await ipcRenderer.invoke('scrape-animal-page-wagtopia', url);
    if (!result.success) {
        throw new Error(result.error);
    }
    return result.data;
}

async function scrapeAnimalPageAdoptapet(url) {
    const result = await ipcRenderer.invoke('scrape-animal-page-adoptapet', url);
    if (!result.success) {
        throw new Error(result.error);
    }
    return result.data;
}

async function scrapeAnimalPage(url) {
    if (selectedRescue === 'adoptapet') {
        return scrapeAnimalPageAdoptapet(url);
    }
    return scrapeAnimalPageWagtopia(url);
}

// App path (equivalent to NL_PATH)
const APP_PATH = path.join(__dirname, '..', '..');

async function writeToLogFile(message) {
    // Don't try to write until LOG_FILE is set and directory exists
    if (!loggingReady || !LOG_FILE) {
        return;
    }

    try {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;

        // Try to append to the log file
        let content = '';
        try {
            content = fs.readFileSync(LOG_FILE, 'utf8');
        } catch (e) {
            // File doesn't exist yet
        }

        fs.writeFileSync(LOG_FILE, content + logLine);
    } catch (err) {
        // Silently fail - can't do much if logging fails
        console.error('Log write failed:', err);
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
        exec(`xdg-open "${LOG_FILE}"`, {});
        showToast('Opening log file...');
    } catch (err) {
        console.error('[App] Failed to open log file:', err);

        // Fallback: show logs in alert
        const recentLogs = logMessages.slice(-50).join('\n');
        alert('Log file location: ' + LOG_FILE + '\n\nRecent logs:\n\n' + recentLogs);
    }
}

// Debug Modal functions
function openDebugModal() {
    document.getElementById('debugModal').classList.add('active');
}

function closeDebugModal() {
    document.getElementById('debugModal').classList.remove('active');
}

// Delete database and reload app (for recovery from corrupted database)
async function deleteDatabaseAndReload() {
    if (!confirm('Are you sure you want to delete the database? This will remove all your animals and settings. The app will reload with a fresh database.')) {
        return;
    }

    try {
        const result = await ipcRenderer.invoke('delete-database-and-reload');
        if (!result.success) {
            alert('Failed to delete database: ' + result.error);
        }
        // App will reload automatically if successful
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Paths derived from database module
let DB_DIR = null;
let DB_PATH = null;

// Setup paths - initialize database and logging
async function setupPaths() {
    log('[App] ========== INITIALIZING APPLICATION ==========');

    try {
        // Initialize database (this also creates directories)
        const { dbDir, dbPath } = await db.initializeAsync();
        DB_DIR = dbDir;
        DB_PATH = dbPath;

        log('[App] Database initialized at:', DB_PATH);

        // Setup logging paths
        LOG_DIR = DB_DIR;
        LOG_FILE = path.join(DB_DIR, 'app.log');
        TMP_DIR = path.join(DB_DIR, 'tmp');

        // Create tmp directory
        fs.mkdirSync(TMP_DIR, { recursive: true });

        log('[App] LOG_FILE set to:', LOG_FILE);

        // Enable file logging now that paths are set
        loggingReady = true;
        log('[App] Logging to file enabled');

        // Update UI
        const subtitle = document.getElementById('subtitle');
        if (subtitle) {
            subtitle.textContent = `Data directory: ${DB_DIR}`;
            subtitle.style.fontSize = '12px';
            subtitle.style.color = '#fff';
        }

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
        }
    } catch (err) {
        log('[App] FATAL ERROR:', err.message);
        throw err;
    }

    log('[App] ========== PATHS CONFIGURED ==========');
    log('[App] DB_PATH:', DB_PATH);
    log('[App] LOG_FILE:', LOG_FILE);
    log('[App] ========================================');
}

let animals = [];
let rescues = []; // Cache of rescue organizations
let currentAnimal = null;
let pendingImageData = null; // Stores new image data before save
let newAnimalImageData = null; // Stores image data for new animal


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

function renderAnimalCard(animal, rescue) {
    const kids = formatCompatibility(animal.kids);
    const dogs = formatCompatibility(animal.dogs);
    const cats = formatCompatibility(animal.cats);

    // Get logo from database (prefer logo_data blob, fall back to file)
    let logoDataUrl = null;
    if (rescue) {
        if (rescue.logo_data) {
            // Use logo stored in database
            const mimeType = rescue.logo_mime || (rescue.logo_path.endsWith('.png') ? 'image/png' : 'image/jpeg');
            const base64 = Buffer.from(rescue.logo_data).toString('base64');
            logoDataUrl = `data:${mimeType};base64,${base64}`;
        } else {
            // Fallback to file-based logo
            const srcDir = path.join(__dirname, '..', '..', 'src');
            const logoPath = path.join(srcDir, rescue.logo_path);
            if (fs.existsSync(logoPath)) {
                const mimeType = rescue.logo_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
                logoDataUrl = `data:${mimeType};base64,${fs.readFileSync(logoPath).toString('base64')}`;
            }
        }
    }

    return `
        <div class="animal-card" data-id="${animal.id}">
            <div class="animal-image-container" onclick="openEditModal(${animal.id})">
                ${animal.imageDataUrl
                    ? `<img class="animal-image" src="${animal.imageDataUrl}" alt="${animal.name}">`
                    : `<div class="no-image">🐕</div>`
                }
                ${logoDataUrl
                    ? `<img class="rescue-logo-badge" src="${logoDataUrl}" alt="${rescue.name}" title="${rescue.name}">`
                    : ''
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
                    <button class="btn-print-front" onclick="event.stopPropagation(); printCardFront(${animal.id})">Print Front</button>
                    <button class="btn-print-back" onclick="event.stopPropagation(); printCardBack(${animal.id})">Print Back</button>
                </div>
            </div>
        </div>
    `;
}

async function loadAnimals() {
    const content = document.getElementById('content');
    const subtitle = document.getElementById('subtitle');

    content.innerHTML = '<div class="loading">Loading animals...</div>';

    // Ensure database is initialized
    if (!db.isConnected()) {
        console.log('[App] Database not initialized, running setupPaths...');
        try {
            await setupPaths();
        } catch (err) {
            console.error('[App] Failed to initialize database:', err);
            content.innerHTML = `
                <div class="error">
                    <h3>Database not initialized</h3>
                    <p>${err.message}</p>
                    <p>Please restart the application.</p>
                </div>
            `;
            subtitle.textContent = 'Error: Database not ready';
            return;
        }
    }

    try {
        // Load rescues for later use
        rescues = db.getAllRescues();
        console.log('[App] Loaded', rescues.length, 'rescues');

        // Update rescue dropdowns with dynamic options
        updateRescueDropdowns();

        animals = db.getAllAnimals();

        if (animals.length === 0) {
            content.innerHTML = '<div class="loading">No animals found. Run the migration first.</div>';
            subtitle.textContent = 'No animals in database';
            return;
        }

        subtitle.textContent = `${animals.length} animals available for adoption`;

        // Load images for each animal
        for (const animal of animals) {
            animal.imageDataUrl = db.getImageAsDataUrl(animal.id);
        }

        // Render all cards with their rescue info
        content.innerHTML = `
            <div class="animals-grid">
                ${animals.map(animal => {
                    const rescue = rescues.find(r => r.id === animal.rescue_id);
                    return renderAnimalCard(animal, rescue);
                }).join('')}
            </div>
        `;

    } catch (err) {
        console.error('Error loading animals:', err);
        const dbPathDisplay = DB_PATH || 'Unknown (not initialized)';
        content.innerHTML = `
            <div class="error">
                <h3>Error loading animals</h3>
                <p>${err.message}</p>
                <p>Make sure sqlite3 is available and the database exists.</p>
                <p style="margin-top: 15px; font-size: 12px; color: #666;">
                    <strong>Database location:</strong><br>
                    <code style="background: rgba(0,0,0,0.1); padding: 4px 8px; border-radius: 4px; word-break: break-all;">${dbPathDisplay}</code>
                </p>
                <button onclick="deleteDatabaseAndReload()" style="margin-top: 15px; padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    🗑️ Delete Database & Reload
                </button>
                <p style="margin-top: 10px; font-size: 11px; color: #888;">This will delete the corrupted database and create a fresh one.</p>
            </div>
        `;
        subtitle.textContent = 'Error loading data';
    }
}

// Rescue Selection Modal functions
function openRescueSelectModal() {
    document.getElementById('rescueSelectModal').classList.add('active');
}

function closeRescueSelectModal() {
    document.getElementById('rescueSelectModal').classList.remove('active');
}

function selectRescue(rescue) {
    selectedRescue = rescue;
    closeRescueSelectModal();
    openSelectFromSiteModal();
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
        openRescueSelectModal();
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

        if (!scrapeAnimalPage) {
            throw new Error('Scraper module not loaded');
        }

        // Call the scraper directly
        const scrapedData = await scrapeAnimalPage(url);
        console.log('[App] Scraper completed');
        console.log('[App] Scraped data:', scrapedData);

        // Close scrape modal
        closeScrapeModal();

        // Load image if available
        if (scrapedData.imagePath) {
            try {
                // Convert relative path to absolute path (relative to APP_PATH)
                const imagePath = path.isAbsolute(scrapedData.imagePath)
                    ? scrapedData.imagePath
                    : path.join(APP_PATH, scrapedData.imagePath);
                console.log('[App] Loading scraped image from:', imagePath);

                // Read the image file
                const data = fs.readFileSync(imagePath);

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
                let hexString = '';
                for (let i = 0; i < data.length; i++) {
                    hexString += data[i].toString(16).padStart(2, '0');
                }

                // Store image data
                newAnimalImageData = {
                    hex: hexString,
                    mime: mime,
                    path: path.basename(imagePath)
                };

                // Convert to base64 for preview
                const base64 = data.toString('base64');
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
        const data = fs.readFileSync(filePath);

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

        // Convert Buffer to hex string for SQLite
        let hexString = '';
        for (let i = 0; i < data.length; i++) {
            hexString += data[i].toString(16).padStart(2, '0');
        }

        // Store new animal image data
        newAnimalImageData = {
            hex: hexString,
            mime: mime,
            path: path.basename(filePath)
        };

        // Convert to base64 for preview
        const base64 = data.toString('base64');
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
    const animalData = {
        name: document.getElementById('newName').value,
        breed: document.getElementById('newBreed').value,
        slug: document.getElementById('newSlug').value,
        age_long: document.getElementById('newAgeLong').value,
        age_short: document.getElementById('newAgeShort').value,
        size: document.getElementById('newSize').value,
        gender: document.getElementById('newGender').value,
        shots: document.getElementById('newShots').value === '1',
        housetrained: document.getElementById('newHousetrained').value === '1',
        kids: document.getElementById('newKids').value,
        dogs: document.getElementById('newDogs').value,
        cats: document.getElementById('newCats').value,
        rescue_id: parseInt(document.getElementById('newRescue').value, 10)
    };

    try {
        console.log('[App] Creating animal with image data:', newAnimalImageData ? 'Yes' : 'No');
        if (newAnimalImageData) {
            console.log('[App] Image data size:', newAnimalImageData.hex.length / 2, 'bytes');
        }
        db.createAnimal(animalData, newAnimalImageData);
        showToast(`${animalData.name} created successfully!`);
        closeManualEntryModal();
        await loadAnimals();
    } catch (err) {
        console.error('[App] Error creating animal:', err);
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

    // Set rescue organization
    document.getElementById('rescue').value = currentAnimal.rescue_id || 1;
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
        const data = fs.readFileSync(filePath);

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

        // Convert Buffer to hex string for SQLite
        let hexString = '';
        for (let i = 0; i < data.length; i++) {
            hexString += data[i].toString(16).padStart(2, '0');
        }

        // Store pending image data
        pendingImageData = {
            hex: hexString,
            mime: mime,
            path: path.basename(filePath)
        };

        // Convert to base64 for preview
        const base64 = data.toString('base64');
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

    const id = parseInt(document.getElementById('animalId').value, 10);
    const animalData = {
        name: document.getElementById('name').value,
        breed: document.getElementById('breed').value,
        slug: document.getElementById('slug').value,
        age_long: document.getElementById('ageLong').value,
        age_short: document.getElementById('ageShort').value,
        size: document.getElementById('size').value,
        gender: document.getElementById('gender').value,
        shots: document.getElementById('shots').value === '1',
        housetrained: document.getElementById('housetrained').value === '1',
        kids: document.getElementById('kids').value,
        dogs: document.getElementById('dogs').value,
        cats: document.getElementById('cats').value,
        rescue_id: parseInt(document.getElementById('rescue').value, 10)
    };

    try {
        db.updateAnimal(id, animalData, pendingImageData);
        showToast(`${animalData.name} updated successfully!`);
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

    try {
        db.deleteAnimal(currentAnimal.id);
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
        closeRescueSelectModal();
        closeCreateModal();
        closeManualEntryModal();
        closeScrapeModal();
        closeSelectFromSiteModal();
        closeDeleteMultipleModal();
        closePrintMultipleModal();
        closePrintSettingsModal();
        closeManageProfilesModal();
        closeSaveProfileDialog();
    }
});

// Print Settings Modal functions
let cachedPrinters = null;
let currentPrintFilePath = null;
let currentPrintCallback = null;
let cachedProfiles = {}; // Cache profiles by printer name
let currentEditProfileId = null;
let saveProfileSource = 'printSettings'; // 'printSettings' or 'manage'

function refreshPrinters() {
    cachedPrinters = null;
    loadPrinters();
}

async function loadPrinters() {
    const printerSelect = document.getElementById('printerSelect');
    const printerStatus = document.getElementById('printerStatus');

    printerStatus.className = 'printer-status loading';
    printerStatus.textContent = 'Loading printers...';

    try {
        const result = await ipcRenderer.invoke('get-printers');

        if (!result.success) {
            throw new Error(result.error || 'Failed to get printers');
        }

        cachedPrinters = result.printers;
        console.log('[App] Loaded printers:', cachedPrinters);

        // Clear and populate printer select
        printerSelect.innerHTML = '';

        if (cachedPrinters.length === 0) {
            printerSelect.innerHTML = '<option value="">No printers found</option>';
            printerStatus.className = 'printer-status error';
            printerStatus.textContent = 'No printers found. Please install a printer.';
            return;
        }

        // Find default printer and add all printers to select
        let defaultPrinterName = null;
        cachedPrinters.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer.name;
            option.textContent = printer.name + (printer.isDefault ? ' (Default)' : '');
            if (printer.isDefault) {
                option.selected = true;
                defaultPrinterName = printer.name;
            }
            printerSelect.appendChild(option);
        });

        printerStatus.className = 'printer-status';
        printerStatus.style.display = 'none';

        // Load profiles for the default/selected printer
        if (printerSelect.value) {
            await loadPrintProfiles(printerSelect.value);
        }

    } catch (err) {
        console.error('[App] Error loading printers:', err);
        printerSelect.innerHTML = '<option value="">Error loading printers</option>';
        printerStatus.className = 'printer-status error';
        printerStatus.textContent = 'Error: ' + err.message;
    }
}

function openPrintSettingsModal(filePath, callback) {
    currentPrintFilePath = filePath;
    currentPrintCallback = callback;

    document.getElementById('printSettingsModal').classList.add('active');

    // Set preview image
    const previewImage = document.getElementById('printPreviewImage');
    previewImage.src = 'file:///' + filePath.replace(/\\/g, '/');

    // Reset form values
    document.getElementById('copiesInput').value = 1;
    document.getElementById('paperSizeSelect').value = 'letter';
    document.querySelector('input[name="orientation"][value="landscape"]').checked = true;

    // Load printers if not cached
    if (!cachedPrinters) {
        loadPrinters();
    } else {
        // Printers already cached, but still need to load profiles for selected printer
        const printerSelect = document.getElementById('printerSelect');
        if (printerSelect.value) {
            loadPrintProfiles(printerSelect.value);
        }
    }
}

function closePrintSettingsModal() {
    document.getElementById('printSettingsModal').classList.remove('active');
    currentPrintFilePath = null;
    currentPrintCallback = null;
}

// Print Profile functions
async function loadPrintProfiles(printerName) {
    const profileSelect = document.getElementById('printProfileSelect');

    try {
        const result = await ipcRenderer.invoke('get-print-profiles', printerName);

        if (!result.success) {
            console.error('[App] Error loading profiles:', result.error);
            return;
        }

        cachedProfiles[printerName] = result.profiles;
        console.log('[App] Loaded profiles for', printerName, ':', result.profiles);

        // Clear and populate profile select
        profileSelect.innerHTML = '<option value="">No profile selected</option>';

        result.profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id;
            const isCalibrated = profile.calibration_ab && profile.calibration_bc &&
                                 profile.calibration_cd && profile.calibration_da;
            let label = profile.name;
            if (profile.is_default) label += ' (Default)';
            if (isCalibrated) label += ' [Cal]';
            option.textContent = label;
            if (profile.is_default) {
                option.selected = true;
            }
            profileSelect.appendChild(option);
        });

        // If there's a default profile, apply its settings
        const defaultProfile = result.profiles.find(p => p.is_default);
        if (defaultProfile) {
            applyPrintProfile(defaultProfile);
        }

    } catch (err) {
        console.error('[App] Error loading profiles:', err);
    }
}

function applyPrintProfile(profile) {
    if (!profile) return;

    document.getElementById('copiesInput').value = profile.copies || 1;
    document.getElementById('paperSizeSelect').value = profile.paper_size || 'letter';
    document.getElementById('paperSourceSelect').value = profile.paper_source || 'default';

    const orientationValue = profile.orientation || 'landscape';
    const orientationRadio = document.querySelector(`input[name="orientation"][value="${orientationValue}"]`);
    if (orientationRadio) {
        orientationRadio.checked = true;
    }

    console.log('[App] Applied profile:', profile.name);
}

async function onPrinterChange() {
    const printerSelect = document.getElementById('printerSelect');
    const printerName = printerSelect.value;

    if (printerName) {
        await loadPrintProfiles(printerName);
    } else {
        // Clear profile select
        const profileSelect = document.getElementById('printProfileSelect');
        profileSelect.innerHTML = '<option value="">No profile selected</option>';
    }
}

function onProfileChange() {
    const profileSelect = document.getElementById('printProfileSelect');
    const printerSelect = document.getElementById('printerSelect');
    const profileId = profileSelect.value;

    if (!profileId || !printerSelect.value) return;

    const profiles = cachedProfiles[printerSelect.value] || [];
    const profile = profiles.find(p => p.id == profileId);

    if (profile) {
        applyPrintProfile(profile);
    }
}

function getCurrentPrintSettings() {
    return {
        copies: parseInt(document.getElementById('copiesInput').value) || 1,
        paper_size: document.getElementById('paperSizeSelect').value || 'letter',
        orientation: document.querySelector('input[name="orientation"]:checked')?.value || 'landscape',
        paper_source: document.getElementById('paperSourceSelect').value || 'default'
    };
}

function openSaveProfileDialog() {
    saveProfileSource = 'printSettings';
    currentEditProfileId = null;

    const printerSelect = document.getElementById('printerSelect');
    const printerName = printerSelect.value;

    if (!printerName) {
        showToast('Please select a printer first', 'error');
        return;
    }

    // Store printer name
    document.getElementById('saveProfilePrinterName').value = printerName;
    document.getElementById('editProfileId').value = '';

    // Get current settings
    const settings = getCurrentPrintSettings();

    // Set settings in dialog inputs
    document.getElementById('saveProfileCopies').value = settings.copies;
    document.getElementById('saveProfilePaperSize').value = settings.paper_size;
    document.getElementById('saveProfilePaperSource').value = settings.paper_source;
    const orientationRadio = document.querySelector(`input[name="saveProfileOrientation"][value="${settings.orientation}"]`);
    if (orientationRadio) orientationRadio.checked = true;

    // Reset form
    document.getElementById('profileNameInput').value = '';
    document.getElementById('setAsDefaultCheckbox').checked = false;
    document.getElementById('saveProfileTitle').textContent = 'Save Print Profile';

    // Clear calibration inputs for new profile
    clearCalibration();

    document.getElementById('saveProfileModal').classList.add('active');
}

function openSaveProfileDialogFromManage() {
    saveProfileSource = 'manage';
    currentEditProfileId = null;

    const printerSelect = document.getElementById('manageProfilesPrinterSelect');
    const printerName = printerSelect.value;

    if (!printerName) {
        showToast('Please select a printer first', 'error');
        return;
    }

    // Close manage profiles modal first to prevent z-index/focus issues
    document.getElementById('manageProfilesModal').classList.remove('active');

    // Store printer name
    document.getElementById('saveProfilePrinterName').value = printerName;
    document.getElementById('editProfileId').value = '';

    // Use default settings
    document.getElementById('saveProfileCopies').value = 1;
    document.getElementById('saveProfilePaperSize').value = 'letter';
    document.getElementById('saveProfilePaperSource').value = 'default';
    document.querySelector('input[name="saveProfileOrientation"][value="landscape"]').checked = true;

    // Reset form
    document.getElementById('profileNameInput').value = '';
    document.getElementById('setAsDefaultCheckbox').checked = false;
    document.getElementById('saveProfileTitle').textContent = 'New Print Profile';

    // Clear calibration inputs for new profile
    clearCalibration();

    document.getElementById('saveProfileModal').classList.add('active');
}

function openEditProfileDialog(profileId) {
    const printerSelect = document.getElementById('manageProfilesPrinterSelect');
    const printerName = printerSelect.value;
    const profiles = cachedProfiles[printerName] || [];
    const profile = profiles.find(p => p.id == profileId);

    if (!profile) {
        showToast('Profile not found', 'error');
        return;
    }

    // Close manage profiles modal first to prevent z-index/focus issues
    document.getElementById('manageProfilesModal').classList.remove('active');

    saveProfileSource = 'manage';
    currentEditProfileId = profileId;

    document.getElementById('saveProfilePrinterName').value = printerName;
    document.getElementById('editProfileId').value = profileId;

    // Set settings in dialog inputs
    document.getElementById('saveProfileCopies').value = profile.copies || 1;
    document.getElementById('saveProfilePaperSize').value = profile.paper_size || 'letter';
    document.getElementById('saveProfilePaperSource').value = profile.paper_source || 'default';
    const orientationValue = profile.orientation || 'landscape';
    const orientationRadio = document.querySelector(`input[name="saveProfileOrientation"][value="${orientationValue}"]`);
    if (orientationRadio) orientationRadio.checked = true;

    // Fill form
    document.getElementById('profileNameInput').value = profile.name;
    document.getElementById('setAsDefaultCheckbox').checked = profile.is_default == 1;
    document.getElementById('saveProfileTitle').textContent = 'Edit Print Profile';

    // Set calibration values if present
    setCalibrationValues(profile);

    document.getElementById('saveProfileModal').classList.add('active');
}

function closeSaveProfileDialog() {
    document.getElementById('saveProfileModal').classList.remove('active');

    // Reopen manage profiles modal if we came from there
    if (saveProfileSource === 'manage') {
        document.getElementById('manageProfilesModal').classList.add('active');
    }

    currentEditProfileId = null;
}

async function saveProfile() {
    const profileName = document.getElementById('profileNameInput').value.trim();
    const printerName = document.getElementById('saveProfilePrinterName').value;
    const isDefault = document.getElementById('setAsDefaultCheckbox').checked;
    const editId = document.getElementById('editProfileId').value;

    if (!profileName) {
        showToast('Please enter a profile name', 'error');
        return;
    }

    if (!printerName) {
        showToast('No printer selected', 'error');
        return;
    }

    // Get settings from dialog inputs
    const settings = {
        copies: parseInt(document.getElementById('saveProfileCopies').value) || 1,
        paper_size: document.getElementById('saveProfilePaperSize').value || 'letter',
        orientation: document.querySelector('input[name="saveProfileOrientation"]:checked')?.value || 'landscape',
        paper_source: document.getElementById('saveProfilePaperSource').value || 'default'
    };

    // Get calibration values from inputs
    const calibration = getCalibrationValues();

    const profileData = {
        id: editId ? parseInt(editId) : null,
        name: profileName,
        printer_name: printerName,
        copies: settings.copies,
        paper_size: settings.paper_size,
        orientation: settings.orientation,
        paper_source: settings.paper_source,
        is_default: isDefault,
        calibration_ab: calibration ? calibration.ab : null,
        calibration_bc: calibration ? calibration.bc : null,
        calibration_cd: calibration ? calibration.cd : null,
        calibration_da: calibration ? calibration.da : null,
        border_top: calibration ? calibration.borderTop : null,
        border_right: calibration ? calibration.borderRight : null,
        border_bottom: calibration ? calibration.borderBottom : null,
        border_left: calibration ? calibration.borderLeft : null
    };

    try {
        const result = await ipcRenderer.invoke('save-print-profile', profileData);

        if (result.success) {
            showToast(editId ? 'Profile updated!' : 'Profile saved!', 'success');
            closeSaveProfileDialog();

            // Refresh profiles
            delete cachedProfiles[printerName];

            if (saveProfileSource === 'printSettings') {
                await loadPrintProfiles(printerName);
            } else {
                await loadProfilesForManagement();
            }
        } else {
            showToast('Error saving profile: ' + result.error, 'error');
        }
    } catch (err) {
        console.error('[App] Error saving profile:', err);
        showToast('Error saving profile: ' + err.message, 'error');
    }
}

// Manage Profiles Modal functions
function openManageProfilesModal() {
    document.getElementById('manageProfilesModal').classList.add('active');

    // Populate printer select
    const printerSelect = document.getElementById('manageProfilesPrinterSelect');
    printerSelect.innerHTML = '<option value="">Select a printer...</option>';

    if (cachedPrinters && cachedPrinters.length > 0) {
        cachedPrinters.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer.name;
            option.textContent = printer.name + (printer.isDefault ? ' (Default)' : '');
            printerSelect.appendChild(option);
        });

        // Select the printer from print settings if available
        const printSettingsPrinter = document.getElementById('printerSelect').value;
        if (printSettingsPrinter) {
            printerSelect.value = printSettingsPrinter;
            loadProfilesForManagement();
        }
    }
}

// Open Manage Profiles from main page (loads printers if needed)
async function openManageProfilesFromMain() {
    document.getElementById('manageProfilesModal').classList.add('active');

    const printerSelect = document.getElementById('manageProfilesPrinterSelect');
    printerSelect.innerHTML = '<option value="">Loading printers...</option>';

    // Load printers if not cached
    if (!cachedPrinters) {
        try {
            const result = await ipcRenderer.invoke('get-printers');
            if (result.success) {
                cachedPrinters = result.printers;
            } else {
                printerSelect.innerHTML = '<option value="">Error loading printers</option>';
                return;
            }
        } catch (err) {
            console.error('[App] Error loading printers:', err);
            printerSelect.innerHTML = '<option value="">Error loading printers</option>';
            return;
        }
    }

    // Populate printer select
    printerSelect.innerHTML = '<option value="">Select a printer...</option>';

    if (cachedPrinters && cachedPrinters.length > 0) {
        let defaultPrinter = null;
        cachedPrinters.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer.name;
            option.textContent = printer.name + (printer.isDefault ? ' (Default)' : '');
            if (printer.isDefault) {
                defaultPrinter = printer.name;
            }
            printerSelect.appendChild(option);
        });

        // Auto-select the default printer and load its profiles
        if (defaultPrinter) {
            printerSelect.value = defaultPrinter;
            loadProfilesForManagement();
        }
    } else {
        printerSelect.innerHTML = '<option value="">No printers found</option>';
    }
}

function closeManageProfilesModal() {
    document.getElementById('manageProfilesModal').classList.remove('active');
}

async function loadProfilesForManagement() {
    const printerSelect = document.getElementById('manageProfilesPrinterSelect');
    const profileList = document.getElementById('profileList');
    const addNewProfileBtn = document.getElementById('addNewProfileBtn');
    const printerName = printerSelect.value;

    if (!printerName) {
        profileList.innerHTML = '<div class="profile-empty">Select a printer to view profiles</div>';
        addNewProfileBtn.style.display = 'none';
        return;
    }

    addNewProfileBtn.style.display = 'block';

    try {
        const result = await ipcRenderer.invoke('get-print-profiles', printerName);

        if (!result.success) {
            profileList.innerHTML = '<div class="profile-empty">Error loading profiles</div>';
            return;
        }

        cachedProfiles[printerName] = result.profiles;

        if (result.profiles.length === 0) {
            profileList.innerHTML = '<div class="profile-empty">No profiles for this printer</div>';
            return;
        }

        profileList.innerHTML = result.profiles.map(profile => {
            const isCalibrated = profile.calibration_ab && profile.calibration_bc &&
                                 profile.calibration_cd && profile.calibration_da;
            return `
            <div class="profile-item">
                <div class="profile-item-info">
                    <div class="profile-item-name">
                        ${escapeHtml(profile.name)}
                        ${profile.is_default ? '<span class="default-badge">Default</span>' : ''}
                        ${isCalibrated ? '<span class="default-badge" style="background: #28a745;">Calibrated</span>' : ''}
                    </div>
                    <div class="profile-item-settings">
                        ${getPaperSizeLabel(profile.paper_size)}, ${capitalizeFirst(profile.orientation)}, ${profile.copies} ${profile.copies === 1 ? 'copy' : 'copies'}
                    </div>
                </div>
                <div class="profile-item-actions">
                    ${!profile.is_default ? `<button class="btn btn-secondary" onclick="setProfileAsDefault(${profile.id})">Set Default</button>` : ''}
                    <button class="btn btn-secondary" onclick="copyProfile(${profile.id})">Copy</button>
                    <button class="btn btn-secondary" onclick="openEditProfileDialog(${profile.id})">Edit</button>
                    <button class="btn btn-danger-outline" onclick="deleteProfile(${profile.id})">Delete</button>
                </div>
            </div>
        `}).join('');

    } catch (err) {
        console.error('[App] Error loading profiles for management:', err);
        profileList.innerHTML = '<div class="profile-empty">Error loading profiles</div>';
    }
}

async function setProfileAsDefault(profileId) {
    try {
        const result = await ipcRenderer.invoke('set-default-print-profile', profileId);

        if (result.success) {
            showToast('Default profile updated!', 'success');

            // Refresh the management list
            const printerName = document.getElementById('manageProfilesPrinterSelect').value;
            delete cachedProfiles[printerName];
            await loadProfilesForManagement();

            // Also refresh the print settings dropdown if same printer
            const printSettingsPrinter = document.getElementById('printerSelect').value;
            if (printSettingsPrinter === printerName) {
                await loadPrintProfiles(printerName);
            }
        } else {
            showToast('Error setting default: ' + result.error, 'error');
        }
    } catch (err) {
        console.error('[App] Error setting default profile:', err);
        showToast('Error setting default: ' + err.message, 'error');
    }
}

async function deleteProfile(profileId) {
    if (!confirm('Are you sure you want to delete this profile?')) {
        return;
    }

    try {
        const result = await ipcRenderer.invoke('delete-print-profile', profileId);

        if (result.success) {
            showToast('Profile deleted!', 'success');

            // Refresh the management list
            const printerName = document.getElementById('manageProfilesPrinterSelect').value;
            delete cachedProfiles[printerName];
            await loadProfilesForManagement();

            // Also refresh the print settings dropdown if same printer
            const printSettingsPrinter = document.getElementById('printerSelect').value;
            if (printSettingsPrinter === printerName) {
                await loadPrintProfiles(printerName);
            }
        } else {
            showToast('Error deleting profile: ' + result.error, 'error');
        }
    } catch (err) {
        console.error('[App] Error deleting profile:', err);
        showToast('Error deleting profile: ' + err.message, 'error');
    }
}

async function copyProfile(profileId) {
    const printerName = document.getElementById('manageProfilesPrinterSelect').value;
    const profiles = cachedProfiles[printerName] || [];
    const profile = profiles.find(p => p.id == profileId);

    if (!profile) {
        showToast('Profile not found', 'error');
        return;
    }

    // Create a copy with a new name
    const newName = profile.name + ' (Copy)';

    const profileData = {
        id: null,
        name: newName,
        printer_name: printerName,
        copies: profile.copies,
        paper_size: profile.paper_size,
        orientation: profile.orientation,
        paper_source: profile.paper_source,
        is_default: false,
        calibration_ab: profile.calibration_ab,
        calibration_bc: profile.calibration_bc,
        calibration_cd: profile.calibration_cd,
        calibration_da: profile.calibration_da,
        border_top: profile.border_top,
        border_right: profile.border_right,
        border_bottom: profile.border_bottom,
        border_left: profile.border_left
    };

    try {
        const result = await ipcRenderer.invoke('save-print-profile', profileData);

        if (result.success) {
            showToast('Profile copied!', 'success');

            // Refresh the management list
            delete cachedProfiles[printerName];
            await loadProfilesForManagement();

            // Also refresh the print settings dropdown if same printer
            const printSettingsPrinter = document.getElementById('printerSelect').value;
            if (printSettingsPrinter === printerName) {
                await loadPrintProfiles(printerName);
            }
        } else {
            showToast('Error copying profile: ' + result.error, 'error');
        }
    } catch (err) {
        console.error('[App] Error copying profile:', err);
        showToast('Error copying profile: ' + err.message, 'error');
    }
}

// Helper functions
function getPaperSizeLabel(size) {
    const labels = {
        'letter': 'Letter (8.5 x 11 in)',
        'legal': 'Legal (8.5 x 14 in)',
        'A4': 'A4 (210 x 297 mm)',
        'A5': 'A5 (148 x 210 mm)'
    };
    return labels[size] || size;
}

function getPaperSourceLabel(source) {
    const labels = {
        'default': 'Default',
        'rear': 'Rear Tray'
    };
    return labels[source] || source;
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function confirmPrint() {
    if (!currentPrintFilePath) {
        showToast('No file to print', 'error');
        return;
    }

    const printerSelect = document.getElementById('printerSelect');
    const profileSelect = document.getElementById('printProfileSelect');
    const copiesInput = document.getElementById('copiesInput');
    const paperSizeSelect = document.getElementById('paperSizeSelect');
    const orientationInput = document.querySelector('input[name="orientation"]:checked');
    const paperSourceSelect = document.getElementById('paperSourceSelect');

    const printerName = printerSelect.value;
    const copies = parseInt(copiesInput.value) || 1;
    const paperSize = paperSizeSelect.value;
    const orientation = orientationInput ? orientationInput.value : 'landscape';
    const paperSource = paperSourceSelect ? paperSourceSelect.value : 'default';

    if (!printerName) {
        showToast('Please select a printer', 'error');
        return;
    }

    // Get calibration values from selected profile if any
    let calibration_ab = null;
    let calibration_bc = null;
    let calibration_cd = null;
    let calibration_da = null;
    let border_top = null;
    let border_right = null;
    let border_bottom = null;
    let border_left = null;

    const profileId = profileSelect.value;
    if (profileId) {
        const profiles = cachedProfiles[printerName] || [];
        const profile = profiles.find(p => p.id == profileId);
        if (profile && profile.calibration_ab && profile.calibration_bc &&
            profile.calibration_cd && profile.calibration_da) {
            calibration_ab = profile.calibration_ab;
            calibration_bc = profile.calibration_bc;
            calibration_cd = profile.calibration_cd;
            calibration_da = profile.calibration_da;
            console.log('[App] Using calibration from profile:', {
                ab: calibration_ab, bc: calibration_bc, cd: calibration_cd, da: calibration_da
            });
        }
        // Get border calibration values (0 is valid)
        if (profile) {
            border_top = profile.border_top;
            border_right = profile.border_right;
            border_bottom = profile.border_bottom;
            border_left = profile.border_left;
            if (border_top !== null || border_right !== null || border_bottom !== null || border_left !== null) {
                console.log('[App] Using border calibration from profile:', {
                    top: border_top, right: border_right, bottom: border_bottom, left: border_left
                });
            }
        }
    }

    console.log('[App] Printing with settings:', {
        printer: printerName,
        copies,
        paperSize,
        orientation,
        paperSource,
        calibration: calibration_ab ? 'yes' : 'no',
        borderCalibration: (border_top !== null || border_right !== null || border_bottom !== null || border_left !== null) ? 'yes' : 'no',
        file: currentPrintFilePath
    });

    const confirmButton = document.getElementById('confirmPrintButton');
    confirmButton.disabled = true;
    confirmButton.textContent = 'Printing...';

    try {
        const printResult = await ipcRenderer.invoke('print-image', currentPrintFilePath, {
            showDialog: false,
            printer: printerName,
            copies: copies,
            paperSize: paperSize,
            orientation: orientation,
            paperSource: paperSource,
            calibration_ab: calibration_ab,
            calibration_bc: calibration_bc,
            calibration_cd: calibration_cd,
            calibration_da: calibration_da,
            border_top: border_top,
            border_right: border_right,
            border_bottom: border_bottom,
            border_left: border_left
        });

        if (printResult.success) {
            showToast('Sent to printer!', 'success');

            // Auto-save profile if settings differ from the selected profile
            if (profileId) {
                const profiles = cachedProfiles[printerName] || [];
                const profile = profiles.find(p => p.id == profileId);
                if (profile) {
                    const settingsChanged =
                        profile.copies !== copies ||
                        profile.paper_size !== paperSize ||
                        profile.orientation !== orientation ||
                        profile.paper_source !== paperSource;

                    if (settingsChanged) {
                        console.log('[App] Profile settings changed, auto-saving...');
                        try {
                            const updateResult = await ipcRenderer.invoke('save-print-profile', {
                                id: parseInt(profileId),
                                name: profile.name,
                                printer_name: printerName,
                                copies: copies,
                                paper_size: paperSize,
                                orientation: orientation,
                                paper_source: paperSource,
                                is_default: profile.is_default,
                                calibration_ab: profile.calibration_ab,
                                calibration_bc: profile.calibration_bc,
                                calibration_cd: profile.calibration_cd,
                                calibration_da: profile.calibration_da,
                                border_top: profile.border_top,
                                border_right: profile.border_right,
                                border_bottom: profile.border_bottom,
                                border_left: profile.border_left
                            });
                            if (updateResult.success) {
                                console.log('[App] Profile auto-saved successfully');
                                // Refresh cached profiles
                                delete cachedProfiles[printerName];
                            }
                        } catch (err) {
                            console.error('[App] Error auto-saving profile:', err);
                        }
                    }
                }
            }

            closePrintSettingsModal();

            // Call callback if provided
            if (currentPrintCallback) {
                currentPrintCallback(true);
            }
        } else {
            showToast('Print error: ' + printResult.error, 'error');
        }
    } catch (err) {
        console.error('[App] Error printing:', err);
        showToast('Print error: ' + err.message, 'error');
    } finally {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Print';
    }
}

// Close modal when clicking outside
document.getElementById('rescueSelectModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeRescueSelectModal();
    }
});

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

document.getElementById('printSettingsModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closePrintSettingsModal();
    }
});

document.getElementById('manageProfilesModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeManageProfilesModal();
    }
});

document.getElementById('saveProfileModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeSaveProfileDialog();
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
        deleteButton.textContent = `Deleting ${idsToDelete.length} animals...`;

        const { successCount, failCount } = db.deleteAnimals(idsToDelete);

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

    // Determine which rescue site to use
    const rescueName = selectedRescue === 'adoptapet' ? 'Brass City Rescue (Adoptapet)' : 'Paws Rescue League (Wagtopia)';
    container.innerHTML = `<div class="loading-spinner">Loading animals from ${rescueName}</div>`;
    importButton.disabled = true;

    try {
        // Get the rescue info from the database based on selected rescue type
        const rescue = db.getRescueByScraperType(selectedRescue);
        if (!rescue) {
            throw new Error(`Rescue not found for scraper type: ${selectedRescue}`);
        }
        console.log('[App] Using rescue:', rescue.name, 'org_id:', rescue.org_id);

        // Call the appropriate list scraper via IPC (runs in main process where Puppeteer works)
        let ipcChannel;
        if (selectedRescue === 'adoptapet') {
            ipcChannel = 'scrape-animal-list-adoptapet';
        } else {
            ipcChannel = 'scrape-animal-list-wagtopia';
        }
        console.log('[App] Calling IPC list scraper:', ipcChannel, 'with org_id:', rescue.org_id);

        const result = await ipcRenderer.invoke(ipcChannel, rescue.org_id);

        console.log('[App] List scraper completed');

        if (!result.success) {
            throw new Error(result.error);
        }

        scrapedAnimals = result.data;
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
                // Call the scraper directly
                const scrapedData = await scrapeAnimalPage(url);
                console.log('[App] Scraped data for:', scrapedData.name);

                // Load image if available
                let imageData = null;
                if (scrapedData.imagePath) {
                    try {
                        const imagePath = path.isAbsolute(scrapedData.imagePath)
                            ? scrapedData.imagePath
                            : path.join(APP_PATH, scrapedData.imagePath);

                        const data = fs.readFileSync(imagePath);
                        const ext = imagePath.split('.').pop().toLowerCase();
                        const mimeTypes = {
                            'jpg': 'image/jpeg',
                            'jpeg': 'image/jpeg',
                            'png': 'image/png',
                            'gif': 'image/gif',
                            'webp': 'image/webp'
                        };
                        const mime = mimeTypes[ext] || 'image/jpeg';

                        let hexString = '';
                        for (let j = 0; j < data.length; j++) {
                            hexString += data[j].toString(16).padStart(2, '0');
                        }

                        imageData = {
                            hex: hexString,
                            mime: mime,
                            path: path.basename(imagePath)
                        };
                    } catch (imgErr) {
                        console.error('[App] Error loading image:', imgErr);
                    }
                }

                // Get the rescue_id for the current selected rescue
                const currentRescue = db.getRescueByScraperType(selectedRescue);
                const rescueId = currentRescue ? currentRescue.id : 1;

                // Insert into database
                const animalData = {
                    name: scrapedData.name,
                    breed: scrapedData.breed,
                    slug: scrapedData.slug,
                    age_long: scrapedData.age_long,
                    age_short: scrapedData.age_short,
                    size: scrapedData.size,
                    gender: scrapedData.gender,
                    shots: scrapedData.shots,
                    housetrained: scrapedData.housetrained,
                    kids: scrapedData.kids,
                    dogs: scrapedData.dogs,
                    cats: scrapedData.cats,
                    rescue_id: rescueId
                };

                db.createAnimal(animalData, imageData);
                console.log('[App] Successfully imported:', scrapedData.name);
                successCount++;

                // Clean up temporary image file
                if (scrapedData.imagePath) {
                    try {
                        const imagePath = path.isAbsolute(scrapedData.imagePath)
                            ? scrapedData.imagePath
                            : path.join(APP_PATH, scrapedData.imagePath);
                        fs.unlinkSync(imagePath);
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

// ============================================================
// Print Calibration Functions
// ============================================================

let expectedCalibrationDistance = 100; // Will be loaded from backend
let expectedBorderInset = 5; // Will be loaded from backend

// Load calibration info from backend
async function loadCalibrationInfo() {
    try {
        const result = await ipcRenderer.invoke('get-calibration-info');
        if (result.success) {
            expectedCalibrationDistance = result.expectedDistance;
            expectedBorderInset = result.expectedBorderInset || 5;
            const distanceDisplay = document.getElementById('expectedDistanceDisplay');
            if (distanceDisplay) {
                distanceDisplay.textContent = expectedCalibrationDistance;
            }
            const borderDisplay = document.getElementById('expectedBorderDisplay');
            if (borderDisplay) {
                borderDisplay.textContent = expectedBorderInset;
            }
        }
    } catch (err) {
        console.error('[App] Error loading calibration info:', err);
    }
}

// Print calibration test page
async function printCalibrationPage() {
    const printerName = document.getElementById('saveProfilePrinterName').value ||
                       document.getElementById('printerSelect').value;

    if (!printerName) {
        showToast('Please select a printer first', 'error');
        return;
    }

    try {
        showToast('Printing calibration test page...', 'success');

        const result = await ipcRenderer.invoke('print-calibration-page', {
            printer: printerName,
            showDialog: false,
            paperSize: document.getElementById('paperSizeSelect')?.value || 'letter',
            paperSource: document.getElementById('paperSourceSelect')?.value || 'default'
        });

        if (result.success) {
            showToast('Calibration page sent to printer', 'success');
        } else {
            showToast('Error printing calibration page: ' + result.error, 'error');
        }
    } catch (err) {
        console.error('[App] Error printing calibration page:', err);
        showToast('Error printing calibration page: ' + err.message, 'error');
    }
}

// Clear calibration values
function clearCalibration() {
    // Default the 100mm square calibration test values to 100
    document.getElementById('calibrationAB').value = '100';
    document.getElementById('calibrationBC').value = '100';
    document.getElementById('calibrationCD').value = '100';
    document.getElementById('calibrationDA').value = '100';
    document.getElementById('borderTop').value = '';
    document.getElementById('borderRight').value = '';
    document.getElementById('borderBottom').value = '';
    document.getElementById('borderLeft').value = '';
    updateCalibrationStatus();
}

// Update calibration status indicator
function updateCalibrationStatus() {
    const ab = parseFloat(document.getElementById('calibrationAB').value);
    const bc = parseFloat(document.getElementById('calibrationBC').value);
    const cd = parseFloat(document.getElementById('calibrationCD').value);
    const da = parseFloat(document.getElementById('calibrationDA').value);

    const statusEl = document.getElementById('calibrationStatus');
    if (!statusEl) return;

    if (ab && bc && cd && da && ab > 0 && bc > 0 && cd > 0 && da > 0) {
        statusEl.textContent = 'Calibrated';
        statusEl.className = 'calibration-status calibrated';
    } else {
        statusEl.textContent = 'Not Calibrated';
        statusEl.className = 'calibration-status not-calibrated';
    }
}

// Get calibration values from inputs
function getCalibrationValues() {
    const ab = parseFloat(document.getElementById('calibrationAB').value) || null;
    const bc = parseFloat(document.getElementById('calibrationBC').value) || null;
    const cd = parseFloat(document.getElementById('calibrationCD').value) || null;
    const da = parseFloat(document.getElementById('calibrationDA').value) || null;

    // Border calibration values (0 is valid, so use different check)
    const borderTopEl = document.getElementById('borderTop');
    const borderRightEl = document.getElementById('borderRight');
    const borderBottomEl = document.getElementById('borderBottom');
    const borderLeftEl = document.getElementById('borderLeft');

    const borderTop = borderTopEl && borderTopEl.value !== '' ? parseFloat(borderTopEl.value) : null;
    const borderRight = borderRightEl && borderRightEl.value !== '' ? parseFloat(borderRightEl.value) : null;
    const borderBottom = borderBottomEl && borderBottomEl.value !== '' ? parseFloat(borderBottomEl.value) : null;
    const borderLeft = borderLeftEl && borderLeftEl.value !== '' ? parseFloat(borderLeftEl.value) : null;

    if (ab && bc && cd && da) {
        return {
            ab, bc, cd, da,
            borderTop, borderRight, borderBottom, borderLeft
        };
    }
    return null;
}

// Set calibration values in inputs
function setCalibrationValues(profile) {
    document.getElementById('calibrationAB').value = profile.calibration_ab || '';
    document.getElementById('calibrationBC').value = profile.calibration_bc || '';
    document.getElementById('calibrationCD').value = profile.calibration_cd || '';
    document.getElementById('calibrationDA').value = profile.calibration_da || '';
    document.getElementById('borderTop').value = profile.border_top !== null && profile.border_top !== undefined ? profile.border_top : '';
    document.getElementById('borderRight').value = profile.border_right !== null && profile.border_right !== undefined ? profile.border_right : '';
    document.getElementById('borderBottom').value = profile.border_bottom !== null && profile.border_bottom !== undefined ? profile.border_bottom : '';
    document.getElementById('borderLeft').value = profile.border_left !== null && profile.border_left !== undefined ? profile.border_left : '';
    updateCalibrationStatus();
}

// Add event listeners for calibration inputs to update status
document.addEventListener('DOMContentLoaded', () => {
    const calibrationInputs = ['calibrationAB', 'calibrationBC', 'calibrationCD', 'calibrationDA'];
    calibrationInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateCalibrationStatus);
        }
    });

    // Load calibration info
    loadCalibrationInfo();
});

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    log('========== Electron app ready ==========');

    // Setup paths and initialize database
    try {
        await setupPaths();
    } catch (err) {
        console.error('[App] Failed to initialize:', err);
        const content = document.getElementById('content');
        if (content) {
            content.innerHTML = `
                <div class="error">
                    <h3>Initialization Failed</h3>
                    <p>${err.message}</p>
                    <p>Please ensure sql.js is installed correctly.</p>
                </div>
            `;
        }
        return;
    }

    // Load animals after initialization
    await loadAnimals();
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
                tempImagePath = path.join(TMP_DIR, `portrait-${animal.id}-${Date.now()}.jpg`);
                console.log('[App] Writing portrait to temp file:', tempImagePath);

                // Convert base64 to binary buffer
                const buffer = Buffer.from(portraitData, 'base64');
                fs.writeFileSync(tempImagePath, buffer);
                console.log('[App] Portrait written to temp file');
                portraitFilePath = tempImagePath;
            } else {
                console.log('[App] No base64 match in imageDataUrl');
            }
        } else {
            console.log('[App] No imageDataUrl available');
        }

        // Get rescue info for this animal
        const rescue = db.getRescueById(animal.rescue_id || 1);
        console.log('[App] Using rescue:', rescue ? rescue.name : 'default');

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
            portraitFilePath: portraitFilePath,
            rescueName: rescue ? rescue.name : 'Paws Rescue League',
            rescueWebsite: rescue ? rescue.website : 'pawsrescueleague.org',
            rescueLogo: rescue ? rescue.logo_path : 'logo.png',
            rescueLogoData: rescue && rescue.logo_data ? Buffer.from(rescue.logo_data).toString('base64') : null,
            rescueLogoMime: rescue ? rescue.logo_mime : null
        };

        console.log('[App] Parameters prepared:', JSON.stringify({...params, rescueLogoData: params.rescueLogoData ? '[BASE64]' : null}));

        // Call the card generation function directly (no subprocess needed)
        const outputPath = await generateCardFront(params);
        console.log('[App] Card generated at:', outputPath);

        // Clean up temporary file
        if (tempImagePath) {
            try {
                fs.unlinkSync(tempImagePath);
                console.log('[App] Cleaned up temp file:', tempImagePath);
            } catch (cleanupErr) {
                console.error('[App] Error cleaning up temp file:', cleanupErr);
            }
        }

        // Platform-specific handling
        if (process.platform === 'win32') {
            // Windows: Open in-app print dialog
            console.log('[App] Opening print settings dialog...');
            openPrintSettingsModal(outputPath, (success) => {
                if (success) {
                    console.log('[App] Card front printed successfully');
                }
            });
        } else {
            // Linux/macOS: Open in GIMP
            console.log('[App] Opening GIMP...');
            const gimpResult = await ipcRenderer.invoke('open-in-gimp', outputPath);
            if (gimpResult.success) {
                console.log('[App] GIMP launched successfully');
                showToast(`Card front generated for ${animal.name}!`);
            } else {
                console.error('[App] Error launching GIMP:', gimpResult.error);
                showToast('Could not launch GIMP. Is it installed?', 'error');
            }
        }
    } catch (err) {
        console.error('[App] Error printing card front:', err);
        console.error('[App] Error stack:', err.stack);
        showToast(`Error generating card: ${err.message}`, 'error');

        // Clean up temporary file on error
        if (tempImagePath) {
            try {
                fs.unlinkSync(tempImagePath);
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
                tempImagePath = path.join(TMP_DIR, `portrait-${animal.id}-${Date.now()}.jpg`);
                console.log('[App] Writing portrait to temp file:', tempImagePath);

                // Convert base64 to binary buffer
                const buffer = Buffer.from(portraitData, 'base64');
                fs.writeFileSync(tempImagePath, buffer);
                console.log('[App] Portrait written to temp file');
                portraitFilePath = tempImagePath;
            } else {
                console.log('[App] No base64 match in imageDataUrl');
            }
        } else {
            console.log('[App] No imageDataUrl available');
        }

        // Get rescue info for this animal
        const rescue = db.getRescueById(animal.rescue_id || 1);
        console.log('[App] Using rescue:', rescue ? rescue.name : 'default');

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
            portraitFilePath: portraitFilePath,
            rescueName: rescue ? rescue.name : 'Paws Rescue League',
            rescueWebsite: rescue ? rescue.website : 'pawsrescueleague.org',
            rescueLogo: rescue ? rescue.logo_path : 'logo.png',
            rescueLogoData: rescue && rescue.logo_data ? Buffer.from(rescue.logo_data).toString('base64') : null,
            rescueLogoMime: rescue ? rescue.logo_mime : null
        };

        console.log('[App] Parameters prepared:', JSON.stringify({...params, rescueLogoData: params.rescueLogoData ? '[BASE64]' : null}));

        // Call the card generation function directly (no subprocess needed)
        const outputPath = await generateCardBack(params);
        console.log('[App] Card generated at:', outputPath);

        // Clean up temporary file
        if (tempImagePath) {
            try {
                fs.unlinkSync(tempImagePath);
                console.log('[App] Cleaned up temp file:', tempImagePath);
            } catch (cleanupErr) {
                console.error('[App] Error cleaning up temp file:', cleanupErr);
            }
        }

        // Platform-specific handling
        if (process.platform === 'win32') {
            // Windows: Open in-app print dialog
            console.log('[App] Opening print settings dialog...');
            openPrintSettingsModal(outputPath, (success) => {
                if (success) {
                    console.log('[App] Card back printed successfully');
                }
            });
        } else {
            // Linux/macOS: Open in GIMP
            console.log('[App] Opening GIMP...');
            const gimpResult = await ipcRenderer.invoke('open-in-gimp', outputPath);
            if (gimpResult.success) {
                console.log('[App] GIMP launched successfully');
                showToast(`Card back generated for ${animal.name}!`);
            } else {
                console.error('[App] Error launching GIMP:', gimpResult.error);
                showToast('Could not launch GIMP. Is it installed?', 'error');
            }
        }
    } catch (err) {
        console.error('[App] Error printing card back:', err);
        console.error('[App] Error stack:', err.stack);
        showToast(`Error generating card: ${err.message}`, 'error');

        // Clean up temporary file on error
        if (tempImagePath) {
            try {
                fs.unlinkSync(tempImagePath);
                console.log('[App] Cleaned up temp file after error:', tempImagePath);
            } catch (cleanupErr) {
                console.error('[App] Error cleaning up temp file after error:', cleanupErr);
            }
        }
    }
}

// ============================================================
// Rescue Management Modal functions
// ============================================================

let currentEditRescue = null;
let pendingRescueLogoData = null;

function openManageRescuesModal() {
    document.getElementById('manageRescuesModal').classList.add('active');
    loadRescueList();
}

function closeManageRescuesModal() {
    document.getElementById('manageRescuesModal').classList.remove('active');
}

function loadRescueList() {
    const listContainer = document.getElementById('rescueList');

    try {
        const allRescues = db.getAllRescues();

        if (allRescues.length === 0) {
            listContainer.innerHTML = '<div class="profile-empty">No rescue organizations found. Click "Add New Rescue" to create one.</div>';
            return;
        }

        let html = '';
        for (const rescue of allRescues) {
            // Get logo as data URL
            let logoHtml = '';
            if (rescue.logo_data) {
                const mimeType = rescue.logo_mime || 'image/png';
                const base64 = Buffer.from(rescue.logo_data).toString('base64');
                logoHtml = `<img src="data:${mimeType};base64,${base64}" style="width: 40px; height: 40px; object-fit: contain; margin-right: 12px; border-radius: 4px; background: #f5f5f5;">`;
            } else {
                logoHtml = `<div style="width: 40px; height: 40px; background: #f0f0f0; border-radius: 4px; margin-right: 12px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 0.8rem;">Logo</div>`;
            }

            html += `
                <div class="profile-item" style="display: flex; align-items: center;">
                    ${logoHtml}
                    <div class="profile-item-info" style="flex: 1;">
                        <div class="profile-item-name">${escapeHtml(rescue.name)}</div>
                        <div class="profile-item-settings">
                            ${rescue.website ? escapeHtml(rescue.website) : 'No website'}
                            ${rescue.scraper_type ? ` | Scraper: ${rescue.scraper_type}` : ''}
                        </div>
                    </div>
                    <div class="profile-item-actions">
                        <button class="btn btn-secondary" onclick="openEditRescueModal(${rescue.id})">Edit</button>
                    </div>
                </div>
            `;
        }

        listContainer.innerHTML = html;
    } catch (err) {
        console.error('[App] Error loading rescues:', err);
        listContainer.innerHTML = `<div class="profile-empty" style="color: #dc3545;">Error loading rescues: ${err.message}</div>`;
    }
}

function openAddRescueModal() {
    currentEditRescue = null;
    pendingRescueLogoData = null;

    document.getElementById('editRescueTitle').textContent = 'Add Rescue Organization';
    document.getElementById('editRescueId').value = '';
    document.getElementById('rescueNameInput').value = '';
    document.getElementById('rescueWebsiteInput').value = '';
    document.getElementById('rescueOrgIdInput').value = '';
    document.getElementById('rescueScraperTypeSelect').value = '';

    // Reset logo preview
    document.getElementById('rescueLogoPreview').style.display = 'none';
    document.getElementById('rescueLogoNoImage').style.display = 'flex';

    // Hide delete button for new rescues
    document.getElementById('deleteRescueBtn').style.display = 'none';

    document.getElementById('editRescueModal').classList.add('active');
}

function openEditRescueModal(rescueId) {
    const rescue = db.getRescueById(rescueId);
    if (!rescue) {
        showToast('Rescue not found', 'error');
        return;
    }

    currentEditRescue = rescue;
    pendingRescueLogoData = null;

    document.getElementById('editRescueTitle').textContent = 'Edit Rescue Organization';
    document.getElementById('editRescueId').value = rescue.id;
    document.getElementById('rescueNameInput').value = rescue.name || '';
    document.getElementById('rescueWebsiteInput').value = rescue.website || '';
    document.getElementById('rescueOrgIdInput').value = rescue.org_id || '';
    document.getElementById('rescueScraperTypeSelect').value = rescue.scraper_type || '';

    // Set logo preview
    const logoPreview = document.getElementById('rescueLogoPreview');
    const logoNoImage = document.getElementById('rescueLogoNoImage');

    if (rescue.logo_data) {
        const mimeType = rescue.logo_mime || 'image/png';
        const base64 = Buffer.from(rescue.logo_data).toString('base64');
        logoPreview.src = `data:${mimeType};base64,${base64}`;
        logoPreview.style.display = 'block';
        logoNoImage.style.display = 'none';
    } else {
        logoPreview.style.display = 'none';
        logoNoImage.style.display = 'flex';
    }

    // Show delete button for existing rescues
    document.getElementById('deleteRescueBtn').style.display = 'block';

    document.getElementById('editRescueModal').classList.add('active');
}

function closeEditRescueModal() {
    document.getElementById('editRescueModal').classList.remove('active');
    currentEditRescue = null;
    pendingRescueLogoData = null;
}

async function handleRescueLogoSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Convert to hex string for database
        let hexString = '';
        for (let i = 0; i < uint8Array.length; i++) {
            hexString += uint8Array[i].toString(16).padStart(2, '0');
        }

        pendingRescueLogoData = {
            hex: hexString,
            mime: file.type || 'image/png',
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
        const logoPreview = document.getElementById('rescueLogoPreview');
        const logoNoImage = document.getElementById('rescueLogoNoImage');
        logoPreview.src = dataUrl;
        logoPreview.style.display = 'block';
        logoNoImage.style.display = 'none';

        showToast('Logo selected. Click Save to apply.');
    } catch (err) {
        console.error('[App] Error loading logo:', err);
        showToast('Error loading logo: ' + err.message, 'error');
    }
}

async function saveRescue() {
    const name = document.getElementById('rescueNameInput').value.trim();
    const website = document.getElementById('rescueWebsiteInput').value.trim();
    const orgId = document.getElementById('rescueOrgIdInput').value.trim();
    const scraperType = document.getElementById('rescueScraperTypeSelect').value;
    const rescueId = document.getElementById('editRescueId').value;

    if (!name) {
        showToast('Please enter a rescue name', 'error');
        return;
    }

    const rescueData = {
        name: name,
        website: website || null,
        org_id: orgId || null,
        scraper_type: scraperType || null
    };

    try {
        if (rescueId) {
            // Update existing rescue
            db.updateRescue(parseInt(rescueId), rescueData, pendingRescueLogoData);
            showToast(`${name} updated successfully!`);
        } else {
            // Create new rescue
            db.createRescue(rescueData, pendingRescueLogoData);
            showToast(`${name} created successfully!`);
        }

        closeEditRescueModal();
        loadRescueList();

        // Refresh the rescues cache and update dropdowns
        rescues = db.getAllRescues();
        updateRescueDropdowns();

    } catch (err) {
        console.error('[App] Error saving rescue:', err);
        showToast('Error saving rescue: ' + err.message, 'error');
    }
}

async function deleteCurrentRescue() {
    if (!currentEditRescue) return;

    const confirmed = confirm(`Are you sure you want to delete "${currentEditRescue.name}"?\n\nThis cannot be undone.`);
    if (!confirmed) return;

    try {
        db.deleteRescue(currentEditRescue.id);
        showToast(`${currentEditRescue.name} deleted successfully!`);

        closeEditRescueModal();
        loadRescueList();

        // Refresh the rescues cache and update dropdowns
        rescues = db.getAllRescues();
        updateRescueDropdowns();

    } catch (err) {
        console.error('[App] Error deleting rescue:', err);
        showToast('Error: ' + err.message, 'error');
    }
}

// Update all rescue dropdown selects with current rescues
function updateRescueDropdowns() {
    const dropdownIds = ['newRescue', 'rescue'];

    for (const dropdownId of dropdownIds) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) continue;

        // Store current selection
        const currentValue = dropdown.value;

        // Clear and repopulate
        dropdown.innerHTML = '';

        for (const rescue of rescues) {
            const option = document.createElement('option');
            option.value = rescue.id;
            option.textContent = rescue.name;
            dropdown.appendChild(option);
        }

        // Restore selection if still valid
        if (currentValue && rescues.find(r => r.id == currentValue)) {
            dropdown.value = currentValue;
        } else if (rescues.length > 0) {
            dropdown.value = rescues[0].id;
        }
    }
}

// Add event listener for clicking outside the modal
document.getElementById('manageRescuesModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeManageRescuesModal();
    }
});

document.getElementById('editRescueModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeEditRescueModal();
    }
});
