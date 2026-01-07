// Database path relative to app location
const DB_PATH = '../db/animals.db';

let animals = [];
let currentAnimal = null;
let pendingImageData = null; // Stores new image data before save

async function runSQL(sql) {
    try {
        const result = await Neutralino.os.execCommand(
            `sqlite3 "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`,
            { cwd: NL_PATH }
        );

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

        // Convert hex to base64
        const bytes = [];
        for (let i = 0; i < hexData.length; i += 2) {
            bytes.push(parseInt(hexData.substr(i, 2), 16));
        }
        const base64 = btoa(String.fromCharCode.apply(null, bytes));

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
        <div class="animal-card" data-id="${animal.id}" onclick="openEditModal(${animal.id})">
            <div class="animal-image-container">
                ${animal.imageDataUrl
                    ? `<img class="animal-image" src="${animal.imageDataUrl}" alt="${animal.name}">`
                    : `<div class="no-image">🐕</div>`
                }
            </div>
            <div class="animal-info">
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

// Modal functions
function openEditModal(animalId) {
    currentAnimal = animals.find(a => a.id === animalId);
    if (!currentAnimal) return;

    pendingImageData = null; // Reset pending image

    document.getElementById('editModal').classList.add('active');
    document.getElementById('modalTitle').textContent = `Edit ${currentAnimal.name}`;

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
async function changeImage() {
    if (!currentAnimal) return;

    try {
        const result = await Neutralino.os.showOpenDialog('Select Image', {
            filters: [
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
            ]
        });

        if (result && result.length > 0) {
            const filePath = result[0];
            await loadNewImage(filePath);
        }
    } catch (err) {
        console.error('Error selecting image:', err);
        showToast('Error selecting image: ' + err.message, 'error');
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

// Close modal on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// Close modal when clicking outside
document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal();
    }
});

// Initialize app
Neutralino.init();

Neutralino.events.on('ready', async () => {
    console.log('Neutralino app ready');
    await loadAnimals();
});

Neutralino.events.on('windowClose', () => {
    Neutralino.app.exit();
});
