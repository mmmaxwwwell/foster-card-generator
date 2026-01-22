const tmp = require('tmp');
const fs = require('fs').promises;
const { rimraf } = require('rimraf');
const path = require('path');
const QRCode = require('qrcode');
const Handlebars = require('handlebars');
const fsSync = require('fs');
const { getOutputDir } = require('./paths.js');

// Enable verbose logging
console.log('[Card Gen] Script started');
console.log('[Card Gen] Working directory:', process.cwd());
console.log('[Card Gen] Script location:', __dirname);

async function createTempDir(params) {
    console.log('[Card Gen] Creating temporary directory...');
    return new Promise((resolve, reject) => {
        tmp.dir({ prefix: 'foster-card-', tmpdir: '/tmp' }, (err, tmpPath, cleanupCallback) => {
            if (err) {
                console.error('[Card Gen] Error creating temp directory:', err);
                reject(err);
            } else {
                console.log('[Card Gen] Temp directory created at:', tmpPath);
                fsSync.mkdirSync(path.join(tmpPath, 'images'), { recursive: true });
                console.log('[Card Gen] Created images subdirectory');

                // Copy necessary assets
                const srcDir = path.join(__dirname, '..', 'src');
                console.log('[Card Gen] Source directory:', srcDir);
                const baseAssets = ['card.css', 'qr.svg', 'qrcode.min.js'];

                Promise.all(
                    baseAssets.map(asset => {
                        const srcPath = path.join(srcDir, asset);
                        const destPath = path.join(tmpPath, asset);
                        console.log(`[Card Gen] Copying ${asset} from ${srcPath} to ${destPath}`);
                        return fs.copyFile(srcPath, destPath);
                    })
                )
                .then(async () => {
                    console.log('[Card Gen] Base assets copied successfully');

                    // Copy the rescue logo (use rescueLogo param or default to logo.png)
                    const logoFilename = params.rescueLogo || 'logo.png';
                    const logoSrcPath = path.join(srcDir, logoFilename);
                    const logoDestPath = path.join(tmpPath, logoFilename);
                    console.log(`[Card Gen] Copying rescue logo ${logoFilename} from ${logoSrcPath} to ${logoDestPath}`);
                    await fs.copyFile(logoSrcPath, logoDestPath);
                    // Copy the portrait image from file path or write from base64 data
                    if (params.portraitFilePath) {
                        console.log('[Card Gen] Copying portrait from file path:', params.portraitFilePath);
                        const destImagePath = path.join(tmpPath, 'images', params.portraitPath || 'portrait.jpg');
                        await fs.copyFile(params.portraitFilePath, destImagePath);
                        console.log('[Card Gen] Portrait copied to:', destImagePath);
                    } else if (params.portraitData) {
                        console.log('[Card Gen] Writing portrait image from base64 data...');
                        const imageBuffer = Buffer.from(params.portraitData, 'base64');
                        const imagePath = path.join(tmpPath, 'images', params.portraitPath || 'portrait.jpg');
                        await fs.writeFile(imagePath, imageBuffer);
                        console.log('[Card Gen] Portrait written to:', imagePath);
                    } else {
                        console.log('[Card Gen] No portrait data or file path provided');
                    }
                    resolve({ tmpPath: tmpPath, cleanup: async () => await rimraf(tmpPath) });
                })
                .catch(err => {
                    console.error('[Card Gen] Error copying assets:', err);
                    reject(err);
                });
            }
        });
    });
}

async function replaceParametersInHtml(fileName, outputPath, params) {
    console.log(`[Card Gen] Processing template: ${fileName}`);

    // Read template
    const templatePath = path.join(__dirname, '..', 'src', fileName);
    console.log(`[Card Gen] Reading template from: ${templatePath}`);
    const source = await fs.readFile(templatePath, 'utf8');
    console.log(`[Card Gen] Template loaded, length: ${source.length} characters`);

    // Generate QR code if needed
    if (fileName === 'card-back.html') {
        try {
            params.qrcode = await QRCode.toDataURL(params.slug || params.adoptionUrl);
            console.log('[Card Gen] QR code generated');
        } catch (err) {
            console.error('[Card Gen] Error generating QR code:', err);
            params.qrcode = `https://chart.googleapis.com/chart?chs=128x128&cht=qr&chl=${encodeURIComponent(params.slug || params.adoptionUrl)}`;
        }
    }

    // Add cards array for the loop (10 cards) for both front and back templates
    if (fileName === 'card-back.html' || fileName === 'card-front.html') {
        params.cards = Array(10).fill({});
        console.log('[Card Gen] Added cards array with 10 items');
    }

    // Process boolean values and convert kids/dogs/cats to emojis
    const processedParams = { ...params };
    for (const key in processedParams) {
        // Special handling for kids, dogs, cats - use checkmark, X, and ?
        if (key === 'kids' || key === 'dogs' || key === 'cats') {
            if (processedParams[key] === true || processedParams[key] === 1 || processedParams[key] === '1') {
                processedParams[key] = "✅";
            } else if (processedParams[key] === false || processedParams[key] === 0 || processedParams[key] === '0') {
                processedParams[key] = "❌";
            } else {
                processedParams[key] = "? ";
            }
        } else if (typeof processedParams[key] === 'boolean') {
            processedParams[key] = processedParams[key] ? "✅" : "❌";
        } else if (processedParams[key] === 1) {
            processedParams[key] = "✅";
        } else if (processedParams[key] === 0) {
            processedParams[key] = "❌";
        }
    }
    console.log('[Card Gen] Processed parameters:', JSON.stringify(processedParams, null, 2));

    // Register a helper to maintain compatibility with the ~variable~ syntax
    Handlebars.registerHelper('tilde', function(context) {
        return new Handlebars.SafeString('~' + context + '~');
    });

    // Convert ~variable~ syntax to Handlebars syntax {{variable}}
    const handlebarsTemplate = source.replace(/~(\w+)~/g, '{{$1}}');

    // Compile and render template
    console.log('[Card Gen] Compiling Handlebars template...');
    const template = Handlebars.compile(handlebarsTemplate);
    const result = template(processedParams);
    console.log(`[Card Gen] Template rendered, length: ${result.length} characters`);

    const outputFilePath = path.join(outputPath, fileName);
    await fs.writeFile(outputFilePath, result, 'utf8');
    console.log(`[Card Gen] Written to: ${outputFilePath}`);
}

async function capture(page, outputPath) {
    console.log('[Card Gen] Capturing screenshot...');
    const div = await page.$("#page");
    if (!div) {
        throw new Error('Could not find #page element in the rendered HTML');
    }
    const bounding_box = await div.boundingBox();
    console.log('[Card Gen] Bounding box:', bounding_box);

    // Use PNG for better DPI metadata preservation
    await page.screenshot({
        path: outputPath,
        clip: {
            x: bounding_box.x,
            y: bounding_box.y,
            width: bounding_box.width,
            height: bounding_box.height
        },
        type: 'png'
    });
    console.log('[Card Gen] Screenshot captured to:', outputPath);
}

async function generateCardFront(params) {
    console.log('[Card Gen] Starting card front generation...');
    console.log('[Card Gen] Launching Puppeteer browser...');
    const { launchBrowser } = require('./browser-helper.js');
    const browser = await launchBrowser();
    console.log('[Card Gen] Browser launched');

    const page = await browser.newPage();
    console.log('[Card Gen] New page created');

    let {tmpPath, cleanup} = await createTempDir(params);
    console.log('[Card Gen] Temp directory ready');

    await replaceParametersInHtml("card-front.html", tmpPath, params);
    console.log('[Card Gen] HTML template processed');

    await page.setViewport({
        width: 3840,
        height: 2160,
        deviceScaleFactor: 2
    });
    console.log('[Card Gen] Viewport set');

    const htmlPath = `file://${path.join(tmpPath, 'card-front.html')}`;
    console.log('[Card Gen] Loading page:', htmlPath);
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    console.log('[Card Gen] Page loaded');

    // Ensure output directory exists - use cross-platform data directory
    const outputDir = getOutputDir();
    console.log('[Card Gen] Creating output directory:', outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `${params.name}-card-front.png`);
    console.log('[Card Gen] Output path:', outputPath);
    await capture(page, outputPath);

    console.log('[Card Gen] Closing browser...');
    await browser.close();
    console.log('[Card Gen] Cleaning up temp directory...');
    await cleanup();
    console.log('[Card Gen] Card generation complete!');

    return outputPath;
}

async function generateCardBack(params) {
    console.log('[Card Gen] Starting card back generation...');
    console.log('[Card Gen] Launching Puppeteer browser...');
    const { launchBrowser } = require('./browser-helper.js');
    const browser = await launchBrowser();
    console.log('[Card Gen] Browser launched');

    const page = await browser.newPage();
    console.log('[Card Gen] New page created');

    let {tmpPath, cleanup} = await createTempDir(params);
    console.log('[Card Gen] Temp directory ready');

    await replaceParametersInHtml("card-back.html", tmpPath, params);
    console.log('[Card Gen] HTML template processed');

    await page.setViewport({
        width: 3840,
        height: 2160,
        deviceScaleFactor: 2
    });
    console.log('[Card Gen] Viewport set');

    const htmlPath = `file://${path.join(tmpPath, 'card-back.html')}`;
    console.log('[Card Gen] Loading page:', htmlPath);
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    console.log('[Card Gen] Page loaded');

    // Ensure output directory exists - use cross-platform data directory
    const outputDir = getOutputDir();
    console.log('[Card Gen] Creating output directory:', outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `${params.name}-card-back.png`);
    console.log('[Card Gen] Output path:', outputPath);
    await capture(page, outputPath);

    console.log('[Card Gen] Closing browser...');
    await browser.close();
    console.log('[Card Gen] Cleaning up temp directory...');
    await cleanup();
    console.log('[Card Gen] Card generation complete!');

    return outputPath;
}

// Export functions for direct use in Electron
module.exports = {
    generateCardFront,
    generateCardBack
};

// CLI execution - only run if called directly (not required as a module)
if (require.main === module) {
    (async () => {
        try {
            // Read JSON from stdin or command line argument
            const args = process.argv.slice(2);
            console.log('[Card Gen] Command line args:', args);
            let params;
            let cardType = 'front'; // default to front

            if (args.length > 0) {
                console.log('[Card Gen] Reading parameters from command line argument');
                console.log('[Card Gen] Raw arg[0]:', args[0]);
                params = JSON.parse(args[0]);
                console.log('[Card Gen] Parsed parameters:', JSON.stringify(params, null, 2));

                // Check if second argument specifies card type
                if (args.length > 1) {
                    cardType = args[1];
                    console.log('[Card Gen] Card type specified:', cardType);
                }
            } else {
                console.log('[Card Gen] Reading parameters from stdin');
                // Read from stdin
                const stdin = await new Promise((resolve) => {
                    let data = '';
                    process.stdin.on('data', chunk => data += chunk);
                    process.stdin.on('end', () => resolve(data));
                });
                console.log('[Card Gen] Stdin data:', stdin);
                params = JSON.parse(stdin);
                console.log('[Card Gen] Parsed parameters:', JSON.stringify(params, null, 2));
            }

            let outputPath;
            if (cardType === 'back') {
                outputPath = await generateCardBack(params);
            } else {
                outputPath = await generateCardFront(params);
            }

            console.log(outputPath);
            console.log('[Card Gen] SUCCESS - Output path written to stdout');
        } catch (err) {
            console.error('[Card Gen] FATAL ERROR:', err.message);
            console.error('[Card Gen] Stack trace:', err.stack);
            process.exit(1);
        }
    })();
}
