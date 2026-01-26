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

// Database module for print profiles
const db = require('./app/db.js');

// Windows printing module
let printWindows = null;
if (process.platform === 'win32') {
    printWindows = require('./app/print-windows.js');
}

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

app.whenReady().then(async () => {
    // Initialize database for print profiles
    await db.initializeAsync();

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

// IPC handler for opening files in GIMP (Linux/macOS) or default viewer (Windows)
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

// IPC handler for getting list of printers
ipcMain.handle('get-printers', async (event) => {
    try {
        const printers = await mainWindow.webContents.getPrintersAsync();
        console.log('[Main] Found', printers.length, 'printers');
        return { success: true, printers };
    } catch (err) {
        console.error('[Main] Error getting printers:', err);
        return { success: false, error: err.message };
    }
});

// IPC handlers for print profiles
ipcMain.handle('get-print-profiles', async (event, printerName) => {
    try {
        let profiles;
        if (printerName) {
            profiles = db.getPrintProfilesByPrinter(printerName);
        } else {
            profiles = db.getAllPrintProfiles();
        }
        return { success: true, profiles };
    } catch (err) {
        console.error('[Main] Error getting print profiles:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-print-profile', async (event, id) => {
    try {
        const profile = db.getPrintProfileById(id);
        return { success: true, profile };
    } catch (err) {
        console.error('[Main] Error getting print profile:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-default-print-profile', async (event, printerName) => {
    try {
        const profile = db.getDefaultPrintProfileForPrinter(printerName);
        return { success: true, profile };
    } catch (err) {
        console.error('[Main] Error getting default print profile:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('save-print-profile', async (event, profile) => {
    try {
        let result;
        if (profile.id) {
            result = db.updatePrintProfile(profile.id, profile);
        } else {
            result = db.createPrintProfile(profile);
        }
        return { success: true, id: result.lastInsertRowid || profile.id };
    } catch (err) {
        console.error('[Main] Error saving print profile:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('delete-print-profile', async (event, id) => {
    try {
        db.deletePrintProfile(id);
        return { success: true };
    } catch (err) {
        console.error('[Main] Error deleting print profile:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('set-default-print-profile', async (event, id) => {
    try {
        db.setDefaultPrintProfile(id);
        return { success: true };
    } catch (err) {
        console.error('[Main] Error setting default print profile:', err);
        return { success: false, error: err.message };
    }
});

// IPC handler for generating calibration test page
ipcMain.handle('generate-calibration-page', async (event, outputDir) => {
    console.log('[Main] Generating calibration test page');

    if (process.platform === 'win32' && printWindows) {
        try {
            const outputPath = path.join(outputDir, 'calibration-test-page.png');
            await printWindows.generateCalibrationTestPage(outputPath);
            return { success: true, path: outputPath };
        } catch (err) {
            console.error('[Main] Error generating calibration page:', err);
            return { success: false, error: err.message };
        }
    }

    return { success: false, error: 'Calibration only supported on Windows' };
});

// IPC handler for printing calibration test page
ipcMain.handle('print-calibration-page', async (event, options = {}) => {
    console.log('[Main] Printing calibration test page');

    if (process.platform === 'win32' && printWindows) {
        try {
            // Save a copy to the user's output folder for inspection
            const { getOutputDir } = require('./app/paths.js');
            const outputDir = getOutputDir();
            const savedPath = path.join(outputDir, `calibration-test-page-${Date.now()}.png`);

            // Generate the calibration page
            await printWindows.generateCalibrationTestPage(savedPath);
            console.log('[Main] Calibration page saved to:', savedPath);

            // Print it
            const result = await printWindows.printPng(savedPath, {
                printer: options.printer,
                showDialog: options.showDialog !== undefined ? options.showDialog : true,
                orientation: 'landscape',
                paperSize: options.paperSize || 'letter',
                copies: 1,
                paperSource: options.paperSource || 'default'
            });

            return { ...result, path: savedPath };
        } catch (err) {
            console.error('[Main] Error printing calibration page:', err);
            return { success: false, error: err.message };
        }
    }

    return { success: false, error: 'Calibration only supported on Windows' };
});

// IPC handler for deleting database and reloading app
ipcMain.handle('delete-database-and-reload', async () => {
    try {
        const dbPath = db.getDbPath();
        console.log('[Main] Deleting database at:', dbPath);

        // Close the database connection
        db.close();

        // Delete the database file
        if (dbPath && fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
            console.log('[Main] Database deleted successfully');
        }

        // Reload the app
        if (mainWindow) {
            mainWindow.reload();
        }

        return { success: true };
    } catch (err) {
        console.error('[Main] Error deleting database:', err);
        return { success: false, error: err.message };
    }
});

// IPC handler for getting calibration expected distance and border inset
ipcMain.handle('get-calibration-info', async () => {
    if (process.platform === 'win32' && printWindows) {
        return {
            success: true,
            expectedDistance: printWindows.CALIBRATION_EXPECTED_DISTANCE_MM,
            expectedBorderInset: printWindows.BORDER_INSET_MM
        };
    }
    return { success: false, error: 'Calibration only supported on Windows' };
});

// IPC handler for printing images
ipcMain.handle('print-image', async (event, filePath, options = {}) => {
    console.log('[Main] Printing image:', filePath);
    console.log('[Main] Print options:', options);

    // On Windows, use PowerShell with .NET System.Drawing.Printing APIs
    if (process.platform === 'win32' && printWindows) {
        try {
            // Build calibration object from profile calibration values if present
            let calibration = null;
            if (options.calibration_ab && options.calibration_bc &&
                options.calibration_cd && options.calibration_da) {
                calibration = {
                    ab: options.calibration_ab,
                    bc: options.calibration_bc,
                    cd: options.calibration_cd,
                    da: options.calibration_da
                };
                console.log('[Main] Using calibration:', calibration);
            }

            // Build border calibration object (0 is a valid value)
            let borderCalibration = null;
            if (options.border_top !== null || options.border_right !== null ||
                options.border_bottom !== null || options.border_left !== null) {
                borderCalibration = {
                    top: options.border_top || 0,
                    right: options.border_right || 0,
                    bottom: options.border_bottom || 0,
                    left: options.border_left || 0
                };
                console.log('[Main] Using border calibration:', borderCalibration);
            }

            const result = await printWindows.printImage(filePath, {
                printer: options.printer,
                showDialog: options.showDialog !== undefined ? options.showDialog : false,
                orientation: options.orientation || 'landscape',
                paperSize: options.paperSize || 'letter',
                copies: options.copies || 1,
                paperSource: options.paperSource || 'default',
                cleanup: true,
                calibration: calibration,
                borderCalibration: borderCalibration
            });
            return result;
        } catch (err) {
            console.error('[Main] Error printing with PowerShell:', err);
            return { success: false, error: err.message };
        }
    }

    // Fallback for other platforms: use Electron's print
    try {
        // Create a hidden window to load and print the image
        const printWindow = new BrowserWindow({
            show: false,
            width: 1056,  // 11 inches at 96 DPI
            height: 816,  // 8.5 inches at 96 DPI
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        // Create HTML content with the image
        const imageUrl = `file:///${filePath.replace(/\\/g, '/')}`;
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    * { margin: 0; padding: 0; }
                    html, body { width: 100%; height: 100%; }
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        background: white;
                    }
                    img {
                        max-width: 100%;
                        max-height: 100%;
                        object-fit: contain;
                    }
                    @media print {
                        @page {
                            size: landscape;
                            margin: 0;
                        }
                        body {
                            width: 100%;
                            height: 100%;
                        }
                        img {
                            width: 100%;
                            height: 100%;
                            object-fit: contain;
                        }
                    }
                </style>
            </head>
            <body>
                <img src="${imageUrl}" />
            </body>
            </html>
        `;

        // Load the HTML content
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        // Wait for image to load
        await new Promise(resolve => setTimeout(resolve, 500));

        // Print - use silent mode if showDialog is false
        const silent = options.showDialog === false;
        return new Promise((resolve) => {
            printWindow.webContents.print({
                silent: silent,
                printBackground: true,
                landscape: options.orientation !== 'portrait',
                copies: options.copies || 1,
                deviceName: options.printer || ''
            }, (success, failureReason) => {
                printWindow.close();
                if (success) {
                    console.log('[Main] Print completed successfully');
                    resolve({ success: true });
                } else {
                    console.log('[Main] Print cancelled or failed:', failureReason);
                    resolve({ success: false, error: failureReason || 'Print cancelled' });
                }
            });
        });
    } catch (err) {
        console.error('[Main] Error printing image:', err);
        return { success: false, error: err.message };
    }
});
