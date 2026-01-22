const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Cross-platform paths
const { ensureDirectories } = require('./app/paths.js');

// Load scrapers in main process where puppeteer works properly
const { scrapeAnimalPage: scrapeWagtopia } = require('./app/scrape-url-wagtopia.js');
const { scrapeAnimalPage: scrapeAdoptapet } = require('./app/scrape-url-adoptapet.js');
const { scrapeAnimalList: scrapeListWagtopia } = require('./app/scrape-list-wagtopia.js');
const { scrapeAnimalList: scrapeListAdoptapet, buildShelterUrl: buildAdoptapetUrl } = require('./app/scrape-list-adoptapet.js');

// Keep a global reference of the window object
let mainWindow;

// Data directories - ensure they exist before window loads
ensureDirectories();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        title: 'Foster Animals',
        icon: path.join(__dirname, 'src', 'logo.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Load the app's index.html
    mainWindow.loadFile(path.join(__dirname, 'app', 'resources', 'index.html'));

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC handler for scraping URLs (Wagtopia)
ipcMain.handle('scrape-animal-page-wagtopia', async (event, url) => {
    try {
        const result = await scrapeWagtopia(url);
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC handler for scraping URLs (Adoptapet)
ipcMain.handle('scrape-animal-page-adoptapet', async (event, url) => {
    try {
        const result = await scrapeAdoptapet(url);
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC handler for scraping animal lists (Wagtopia)
ipcMain.handle('scrape-animal-list-wagtopia', async (event, orgId) => {
    try {
        const url = `https://www.wagtopia.com/search/org?id=${orgId}&iframe=normal`;
        const result = await scrapeListWagtopia(url);
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC handler for scraping animal lists (Adoptapet)
ipcMain.handle('scrape-animal-list-adoptapet', async (event, shelterId) => {
    try {
        const url = buildAdoptapetUrl(shelterId);
        const result = await scrapeListAdoptapet(url);
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC handler for opening files in GIMP (Linux/macOS) or opening image (Windows)
ipcMain.handle('open-in-gimp', async (event, filePath) => {
    if (process.platform === 'win32') {
        // Windows: Open with default image viewer
        console.log('[Main] Opening image on Windows:', filePath);
        try {
            const result = await shell.openPath(filePath);
            if (result) {
                console.error('[Main] Shell open error:', result);
                return { success: false, error: result };
            }
            console.log('[Main] Opened with default app successfully');
            return { success: true };
        } catch (err) {
            console.error('[Main] Error opening file:', err);
            return { success: false, error: err.message };
        }
    } else {
        // Linux/macOS: Use GIMP from PATH
        return new Promise((resolve) => {
            const gimpCommand = 'gimp';
            const fullCommand = `${gimpCommand} "${filePath}"`;
            console.log('[Main] Launching GIMP with command:', fullCommand);

            // Clear Electron's LD_LIBRARY_PATH to avoid library conflicts on Linux
            const env = { ...process.env };
            delete env.LD_LIBRARY_PATH;

            const child = exec(fullCommand, { env }, (err, stdout, stderr) => {
                if (err) {
                    console.error('[Main] GIMP exec error:', err.message);
                    if (stderr) console.error('[Main] GIMP stderr:', stderr);
                }
                if (stdout) console.log('[Main] GIMP stdout:', stdout);
            });

            // Give it a moment to check if the process spawned
            setTimeout(() => {
                if (child.pid) {
                    console.log('[Main] GIMP process started with PID:', child.pid);
                    resolve({ success: true });
                } else {
                    console.error('[Main] GIMP process failed to start');
                    resolve({ success: false, error: 'Failed to start GIMP process' });
                }
            }, 500);
        });
    }
});
