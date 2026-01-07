#!/usr/bin/env node
/**
 * Migration script to seed SQLite database from YAML files
 * Uses sqlite3 CLI (NixOS compatible) instead of better-sqlite3
 * Usage: node db/migrate.js [--reset]
 *   --reset: Drop and recreate the database
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

const DB_PATH = path.join(__dirname, 'animals.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const DOGS_DIR = path.join(__dirname, '..', 'src', 'dogs.d');
const IMAGES_DIR = path.join(__dirname, '..', 'src', 'images');

// Parse command line arguments
const args = process.argv.slice(2);
const shouldReset = args.includes('--reset');

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

function findImageFile(portraitPath) {
    // Try exact match first
    const exactPath = path.join(IMAGES_DIR, portraitPath);
    if (fs.existsSync(exactPath)) {
        return exactPath;
    }

    // Try case-insensitive match
    const baseName = path.basename(portraitPath, path.extname(portraitPath)).toLowerCase();
    const files = fs.readdirSync(IMAGES_DIR);

    for (const file of files) {
        const fileBaseName = path.basename(file, path.extname(file)).toLowerCase();
        if (fileBaseName === baseName) {
            return path.join(IMAGES_DIR, file);
        }
    }

    return null;
}

function convertBooleanField(value) {
    if (value === true || value === 1 || value === '1' || value === 'true') {
        return '1';
    }
    if (value === false || value === 0 || value === '0' || value === 'false') {
        return '0';
    }
    return '?';
}

function escapeSQL(str) {
    if (str === null || str === undefined) return 'NULL';
    return "'" + String(str).replace(/'/g, "''") + "'";
}

function runSQL(sql) {
    try {
        execSync(`sqlite3 "${DB_PATH}"`, {
            input: sql,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
    } catch (err) {
        console.error('SQL Error:', err.message);
        throw err;
    }
}

function main() {
    console.log('Starting database migration...\n');

    // Handle reset
    if (shouldReset && fs.existsSync(DB_PATH)) {
        console.log('Resetting database...');
        fs.unlinkSync(DB_PATH);
    }

    console.log(`Database: ${DB_PATH}`);

    // Run schema
    console.log('Applying schema...');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    runSQL(schema);

    // Check for existing records
    try {
        const countOutput = execSync(`sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM animals;"`, { encoding: 'utf8' });
        const existingCount = parseInt(countOutput.trim(), 10);
        if (existingCount > 0 && !shouldReset) {
            console.log(`\nDatabase already contains ${existingCount} animals.`);
            console.log('Use --reset flag to drop and recreate the database.');
            return;
        }
    } catch (err) {
        // Table might not exist yet, continue
    }

    // Read YAML files
    if (!fs.existsSync(DOGS_DIR)) {
        console.error(`Error: Dogs directory not found: ${DOGS_DIR}`);
        process.exit(1);
    }

    const yamlFiles = fs.readdirSync(DOGS_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    console.log(`\nFound ${yamlFiles.length} YAML files in ${DOGS_DIR}\n`);

    let successCount = 0;
    let errorCount = 0;

    // Process each YAML file
    for (const file of yamlFiles) {
        const filePath = path.join(DOGS_DIR, file);
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = yaml.load(content);

            // Find and load image
            let portraitDataHex = null;
            let portraitMime = null;
            let resolvedPortraitPath = null;

            if (data.portraitPath) {
                const imagePath = findImageFile(data.portraitPath);
                if (imagePath) {
                    const imageBuffer = fs.readFileSync(imagePath);
                    portraitDataHex = imageBuffer.toString('hex');
                    portraitMime = getMimeType(imagePath);
                    resolvedPortraitPath = path.basename(imagePath);
                    console.log(`  [OK] ${data.name}: Found image ${resolvedPortraitPath}`);
                } else {
                    console.log(`  [WARN] ${data.name}: Image not found: ${data.portraitPath}`);
                    resolvedPortraitPath = data.portraitPath;
                }
            }

            // Build INSERT statement
            const sql = `
                INSERT INTO animals (
                    name, slug, size, shots, housetrained, breed,
                    age_long, age_short, gender, kids, dogs, cats,
                    portrait_path, portrait_data, portrait_mime
                ) VALUES (
                    ${escapeSQL(data.name)},
                    ${escapeSQL(data.slug)},
                    ${escapeSQL(data.size)},
                    ${data.shots ? 1 : 0},
                    ${data.housetrained ? 1 : 0},
                    ${escapeSQL(data.breed)},
                    ${escapeSQL(data.ageLong)},
                    ${escapeSQL(data.ageShort)},
                    ${escapeSQL(data.gender)},
                    ${escapeSQL(convertBooleanField(data.kids))},
                    ${escapeSQL(convertBooleanField(data.dogs))},
                    ${escapeSQL(convertBooleanField(data.cats))},
                    ${escapeSQL(resolvedPortraitPath)},
                    ${portraitDataHex ? `X'${portraitDataHex}'` : 'NULL'},
                    ${escapeSQL(portraitMime)}
                );
            `;

            runSQL(sql);
            successCount++;
        } catch (err) {
            console.error(`  [ERROR] ${file}: ${err.message}`);
            errorCount++;
        }
    }

    console.log('\n--- Migration Summary ---');
    console.log(`Successfully imported: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Database location: ${DB_PATH}`);
}

main();
