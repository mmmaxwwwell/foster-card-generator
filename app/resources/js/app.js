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
    }
});

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
            rescueLogo: rescue ? rescue.logo_path : 'logo.png'
        };

        console.log('[App] Parameters prepared:', JSON.stringify({...params}));

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

        // Open in GIMP via IPC (cross-platform)
        console.log('[App] Opening GIMP...');
        const gimpResult = await ipcRenderer.invoke('open-in-gimp', outputPath);
        if (gimpResult.success) {
            console.log('[App] GIMP launched successfully');
        } else {
            console.error('[App] Error launching GIMP:', gimpResult.error);
            showToast('Could not launch GIMP. Is it installed?', 'error');
        }

        showToast(`Card front generated for ${animal.name}!`);
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
            rescueLogo: rescue ? rescue.logo_path : 'logo.png'
        };

        console.log('[App] Parameters prepared:', JSON.stringify({...params}));

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

        // Open in GIMP via IPC (cross-platform)
        console.log('[App] Opening GIMP...');
        const gimpResult = await ipcRenderer.invoke('open-in-gimp', outputPath);
        if (gimpResult.success) {
            console.log('[App] GIMP launched successfully');
        } else {
            console.error('[App] Error launching GIMP:', gimpResult.error);
            showToast('Could not launch GIMP. Is it installed?', 'error');
        }

        showToast(`Card back generated for ${animal.name}!`);
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
