// Shared harness for Foster Card Generator E2E tests.
//
// Responsibilities:
//  - Ensure the unpacked Electron build exists under dist/linux-unpacked/.
//  - Start the fixture proxy from proxy.js.
//  - Create an isolated HOME tempdir so the app's sqlite lives there.
//  - Launch the packaged Electron binary via Playwright's _electron.launch
//    with --ignore-certificate-errors and --proxy-server pointing at the
//    fixture proxy.
//  - Expose a cleanup() that tears everything down.
//  - Expose readAnimalsDb() for direct sqlite assertions.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { _electron: electron } = require('playwright');
const initSqlJs = require('sql.js');

const { startProxy } = require('./proxy.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const UNPACKED_DIR = path.join(REPO_ROOT, 'dist', 'linux-unpacked');
const APP_BINARY = path.join(UNPACKED_DIR, 'foster-card-generator');

function ensureBuild() {
  if (fs.existsSync(APP_BINARY)) return;
  // Build only the unpacked directory (skip AppImage/deb).
  // Use nix develop to get the right Node/Electron toolchain.
  execSync('nix develop --command bash -c "npm run build:linux -- --dir"', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (!fs.existsSync(APP_BINARY)) {
    throw new Error(`build completed but ${APP_BINARY} not found`);
  }
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {}
}

async function setup({ verbose = false } = {}) {
  ensureBuild();

  const proxy = await startProxy({ verbose });
  const proxyPort = proxy.port;

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fcg-e2e-'));

  const app = await electron.launch({
    executablePath: APP_BINARY,
    args: [
      '--ignore-certificate-errors',
      `--proxy-server=http://127.0.0.1:${proxyPort}`,
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      HOME: tmpHome,
      HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
      HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      // Opt-in flags read by app/browser-helper.js and app/scrape-url-adoptapet.js
      // so puppeteer and native fetch route through the fixture proxy with the
      // self-signed cert accepted. No production path sets these.
      E2E_PROXY_SERVER: `http://127.0.0.1:${proxyPort}`,
      E2E_IGNORE_CERT_ERRORS: '1',
    },
    timeout: 30000,
  });

  const window = await app.firstWindow();

  async function cleanup() {
    try {
      await app.close();
    } catch (_) {}
    try {
      await proxy.stop();
    } catch (_) {}
    rmrf(tmpHome);
  }

  return { app, window, proxy, tmpHome, cleanup };
}

// Open the sqlite file written by the app under the isolated HOME and return
// all rows from the `animals` table.
async function readAnimalsDb(tmpHome) {
  const dbPath = path.join(
    tmpHome,
    '.local',
    'share',
    'foster-card-generator',
    'animals.db'
  );
  if (!fs.existsSync(dbPath)) {
    throw new Error(`animals.db not found at ${dbPath}`);
  }
  // Locate the sql.js WASM file relative to the repo's node_modules.
  const wasmCandidates = [
    path.join(REPO_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  const wasmPath = wasmCandidates.find((p) => fs.existsSync(p));
  if (!wasmPath) {
    throw new Error('sql.js WASM not found in node_modules');
  }
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const data = fs.readFileSync(dbPath);
  const db = new SQL.Database(new Uint8Array(data));
  const result = db.exec('SELECT * FROM animals');
  const rows = [];
  if (result.length > 0) {
    const { columns, values } = result[0];
    for (const row of values) {
      const obj = {};
      for (let i = 0; i < columns.length; i++) obj[columns[i]] = row[i];
      rows.push(obj);
    }
  }
  db.close();
  return rows;
}

module.exports = { setup, readAnimalsDb };
