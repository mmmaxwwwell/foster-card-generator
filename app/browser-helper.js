const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Find an available browser executable on the system
 * @returns {string|null} Path to browser executable, or null to use Puppeteer's default
 */
function findBrowserExecutable() {
    if (process.platform === 'win32') {
        // Windows: Check for Chrome and Edge
        const possiblePaths = [
            // Chrome paths
            path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            // Edge paths (installed on all Windows 10/11 systems)
            path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ];

        for (const browserPath of possiblePaths) {
            if (fs.existsSync(browserPath)) {
                console.log('[Browser Helper] Found browser at:', browserPath);
                return browserPath;
            }
        }
    } else if (process.platform === 'darwin') {
        // macOS: Check for Chrome
        const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        if (fs.existsSync(chromePath)) {
            return chromePath;
        }
    } else {
        // Linux: Check common paths
        const possiblePaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
        ];

        for (const browserPath of possiblePaths) {
            if (fs.existsSync(browserPath)) {
                return browserPath;
            }
        }
    }

    // No system browser found, return null to try Puppeteer's bundled browser
    console.log('[Browser Helper] No system browser found, will try Puppeteer default');
    return null;
}

/**
 * Launch a browser with appropriate settings for the environment
 * @param {object} options - Additional Puppeteer launch options
 * @returns {Promise<Browser>} Puppeteer browser instance
 */
async function launchBrowser(options = {}) {
    const executablePath = findBrowserExecutable();

    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...options,
    };

    // Only set executablePath if we found a system browser
    if (executablePath) {
        launchOptions.executablePath = executablePath;
    }

    return puppeteer.launch(launchOptions);
}

module.exports = { launchBrowser, findBrowserExecutable };
