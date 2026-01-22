const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Get the application data directory (cross-platform)
 * @returns {string} Path to the app data directory
 */
function getDataDir() {
    let dataDir;

    if (process.platform === 'win32') {
        // Windows: Use AppData\Local
        dataDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'foster-card-generator');
    } else if (process.platform === 'darwin') {
        // macOS: Use ~/Library/Application Support
        dataDir = path.join(os.homedir(), 'Library', 'Application Support', 'foster-card-generator');
    } else {
        // Linux: Use ~/.local/share
        dataDir = path.join(os.homedir(), '.local', 'share', 'foster-card-generator');
    }

    return dataDir;
}

/**
 * Get the temp directory for the app
 * @returns {string} Path to the temp directory
 */
function getTmpDir() {
    return path.join(getDataDir(), 'tmp');
}

/**
 * Get the output directory for the app
 * @returns {string} Path to the output directory
 */
function getOutputDir() {
    return path.join(getDataDir(), 'output');
}

/**
 * Ensure all required directories exist
 */
function ensureDirectories() {
    const dirs = [getDataDir(), getTmpDir(), getOutputDir()];
    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

module.exports = {
    getDataDir,
    getTmpDir,
    getOutputDir,
    ensureDirectories
};
