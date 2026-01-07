// Database path relative to app location
const DB_PATH = '../db/animals.db';

let animals = [];

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
        // Query for base64-encoded image data
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

function renderAnimalCard(animal) {
    const kids = formatCompatibility(animal.kids);
    const dogs = formatCompatibility(animal.dogs);
    const cats = formatCompatibility(animal.cats);

    return `
        <div class="animal-card" data-id="${animal.id}">
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
        // Query all animals (excluding blob data for initial load)
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

// Initialize app
Neutralino.init();

Neutralino.events.on('ready', async () => {
    console.log('Neutralino app ready');
    await loadAnimals();
});

Neutralino.events.on('windowClose', () => {
    Neutralino.app.exit();
});
