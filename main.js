const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// Load scraper in main process where puppeteer works properly
const { scrapeAnimalPage } = require('./app/scrape-url.js');

// Keep a global reference of the window object
let mainWindow;

// Data directories - ensure they exist before window loads
const DATA_DIR = path.join(os.homedir(), '.local', 'share', 'foster-card-generator');
const dirs = [DATA_DIR, path.join(DATA_DIR, 'tmp'), path.join(DATA_DIR, 'output')];
for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
}

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

// IPC handler for scraping URLs
ipcMain.handle('scrape-animal-page', async (event, url) => {
    try {
        const result = await scrapeAnimalPage(url);
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC handler for opening files in GIMP (cross-platform)
ipcMain.handle('open-in-gimp', async (event, filePath) => {
    return new Promise((resolve) => {
        let gimpCommand;

        if (process.platform === 'win32') {
            // Windows: Try common GIMP installation paths
            const possiblePaths = [
                path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'GIMP 2', 'bin', 'gimp-2.10.exe'),
                path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GIMP 2', 'bin', 'gimp-2.10.exe'),
                path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'GIMP 2', 'bin', 'gimp.exe'),
                path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'GIMP 2', 'bin', 'gimp-2.10.exe'),
            ];

            gimpCommand = null;
            for (const gimpPath of possiblePaths) {
                if (fs.existsSync(gimpPath)) {
                    gimpCommand = `"${gimpPath}"`;
                    break;
                }
            }

            if (!gimpCommand) {
                gimpCommand = 'gimp';
            }
        } else {
            // Linux/macOS: Use 'gimp' from PATH
            gimpCommand = 'gimp';
        }

        const fullCommand = `${gimpCommand} "${filePath}"`;
        console.log('[Main] Launching GIMP with command:', fullCommand);

        // Clear Electron's LD_LIBRARY_PATH to avoid library conflicts on Linux
        const env = { ...process.env };
        if (process.platform !== 'win32') {
            delete env.LD_LIBRARY_PATH;
        }

        exec(fullCommand, { env }, (err, stdout, stderr) => {
            if (err) {
                console.error('[Main] GIMP exec error:', err.message);
                if (stderr) console.error('[Main] GIMP stderr:', stderr);
            }
            if (stdout) console.log('[Main] GIMP stdout:', stdout);
        });

        // Don't wait for GIMP to exit, just resolve immediately
        resolve({ success: true });
    });
});
