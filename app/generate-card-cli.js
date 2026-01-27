const tmp = require('tmp');
const fs = require('fs').promises;
const { rimraf } = require('rimraf');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const Handlebars = require('handlebars');
const sharp = require('sharp');
const { getOutputDir } = require('./paths.js');

// DPI configuration - default 360 DPI for high-quality printing
const DEFAULT_DPI = 360;

// CSS standard DPI (browsers always render CSS inches at 96 DPI)
const CSS_DPI = 96;

// Enable verbose logging
console.log('[Card Gen] Script started');
console.log('[Card Gen] Working directory:', process.cwd());
console.log('[Card Gen] Script location:', __dirname);

/**
 * Calculate viewport dimensions based on target DPI and page size
 *
 * @param {Object} config - Template configuration
 * @param {number} config.pageWidthInches - Page width in inches
 * @param {number} config.pageHeightInches - Page height in inches
 * @param {number} config.dpi - Target DPI (dots per inch)
 * @returns {{width: number, height: number, deviceScaleFactor: number}}
 */
function calculateViewport(config) {
    const dpi = config.dpi || DEFAULT_DPI;
    const pageWidthInches = config.pageWidthInches || 11;
    const pageHeightInches = config.pageHeightInches || 8.5;

    // Viewport in CSS pixels (at 96 DPI)
    const width = Math.round(pageWidthInches * CSS_DPI);
    const height = Math.round(pageHeightInches * CSS_DPI);

    // Scale factor to achieve target DPI
    const deviceScaleFactor = dpi / CSS_DPI;

    return {
        width,
        height,
        deviceScaleFactor
    };
}

/**
 * Create a temporary directory for rendering
 *
 * @returns {Promise<{tmpPath: string, cleanup: Function}>}
 */
async function createTempDir() {
    console.log('[Card Gen] Creating temporary directory...');
    return new Promise((resolve, reject) => {
        tmp.dir({ prefix: 'foster-card-', tmpdir: os.tmpdir() }, (err, tmpPath) => {
            if (err) {
                console.error('[Card Gen] Error creating temp directory:', err);
                reject(err);
            } else {
                console.log('[Card Gen] Temp directory created at:', tmpPath);
                resolve({ tmpPath: tmpPath, cleanup: async () => await rimraf(tmpPath) });
            }
        });
    });
}

/**
 * Preprocess parameters based on template configuration
 * Handles boolean conversion, QR code generation, etc.
 *
 * @param {Object} params - Raw parameters
 * @param {Object} config - Template configuration
 * @returns {Promise<Object>} - Processed parameters ready for Handlebars
 */
async function preprocessParams(params, config) {
    const preprocessing = config.preprocessing || {};
    const processedParams = { ...params };

    // Generate QR code if configured (using local qrcode library - no web calls)
    if (preprocessing.generateQrCode) {
        const qrSource = processedParams[preprocessing.qrCodeSource || 'slug'] || processedParams.adoptionUrl;
        const qrField = preprocessing.qrCodeField || 'qrcode';

        if (qrSource) {
            try {
                // Generate QR code locally as data URL using the qrcode npm package
                processedParams[qrField] = await QRCode.toDataURL(qrSource, {
                    errorCorrectionLevel: 'M',
                    type: 'image/png',
                    width: 256,
                    margin: 1
                });
                console.log('[Card Gen] QR code generated locally');
            } catch (err) {
                console.error('[Card Gen] Error generating QR code:', err);
                // Generate a placeholder SVG as fallback (no web calls)
                processedParams[qrField] = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="100%" height="100%" fill="white"/><text x="50%" y="50%" text-anchor="middle" font-size="10" fill="black">QR Error</text></svg>`)}`;
                console.log('[Card Gen] Using fallback placeholder for QR code');
            }
        }
    }

    // Convert boolean fields to emoji
    if (preprocessing.convertBooleans) {
        const booleanFields = preprocessing.booleanFields || ['shots', 'housetrained'];
        for (const field of booleanFields) {
            if (field in processedParams) {
                const value = processedParams[field];
                if (value === true || value === 1 || value === '1') {
                    processedParams[field] = "✅";
                } else if (value === false || value === 0 || value === '0') {
                    processedParams[field] = "❌";
                }
            }
        }

        // Handle tri-state fields (?, 0, 1)
        const triStateFields = preprocessing.triStateFields || ['kids', 'dogs', 'cats'];
        for (const field of triStateFields) {
            if (field in processedParams) {
                const value = processedParams[field];
                if (value === true || value === 1 || value === '1') {
                    processedParams[field] = "✅";
                } else if (value === false || value === 0 || value === '0') {
                    processedParams[field] = "❌";
                } else {
                    processedParams[field] = "? ";
                }
            }
        }
    }

    console.log('[Card Gen] Processed parameters:', JSON.stringify(processedParams, null, 2));
    return processedParams;
}

/**
 * Render HTML template with Handlebars
 *
 * @param {string} htmlTemplate - HTML template string with Handlebars syntax
 * @param {string} outputPath - Directory to write rendered HTML
 * @param {string} outputFilename - Filename for rendered HTML
 * @param {Object} params - Parameters to inject into template
 * @returns {Promise<string>} - Path to rendered HTML file
 */
async function renderTemplate(htmlTemplate, outputPath, outputFilename, params) {
    console.log(`[Card Gen] Rendering template to ${outputFilename}`);

    // Register Handlebars helpers
    Handlebars.registerHelper('tilde', function(context) {
        return new Handlebars.SafeString('~' + context + '~');
    });

    // Register repeat helper for repeating card content
    Handlebars.registerHelper('repeat', function(count, options) {
        let result = '';
        for (let i = 0; i < count; i++) {
            // Add @index to the data context
            const data = Handlebars.createFrame(options.data);
            data.index = i;
            result += options.fn(this, { data: data });
        }
        return result;
    });

    // Compile and render template
    console.log('[Card Gen] Compiling Handlebars template...');
    const template = Handlebars.compile(htmlTemplate);
    const result = template(params);
    console.log(`[Card Gen] Template rendered, length: ${result.length} characters`);

    const outputFilePath = path.join(outputPath, outputFilename);
    await fs.writeFile(outputFilePath, result, 'utf8');
    console.log(`[Card Gen] Written to: ${outputFilePath}`);

    return outputFilePath;
}

/**
 * Capture screenshot of rendered HTML page
 *
 * @param {Object} page - Puppeteer page instance
 * @param {string} outputPath - Path for output PNG
 * @param {Object} config - Template configuration
 */
async function capture(page, outputPath, config) {
    console.log('[Card Gen] Capturing screenshot...');

    const dpi = config.dpi || DEFAULT_DPI;
    const pageWidthInches = config.pageWidthInches || 11;
    const pageHeightInches = config.pageHeightInches || 8.5;

    const div = await page.$("#page");
    if (!div) {
        throw new Error('Could not find #page element in the rendered HTML');
    }
    const bounding_box = await div.boundingBox();
    console.log('[Card Gen] Bounding box:', bounding_box);

    // Calculate exact target dimensions for the output
    const targetWidth = Math.round(pageWidthInches * dpi);
    const targetHeight = Math.round(pageHeightInches * dpi);
    console.log(`[Card Gen] Target dimensions: ${targetWidth}x${targetHeight} pixels (${dpi} DPI)`);

    // Capture screenshot to buffer first
    const screenshotBuffer = await page.screenshot({
        clip: {
            x: bounding_box.x,
            y: bounding_box.y,
            width: bounding_box.width,
            height: bounding_box.height
        },
        type: 'png'
    });
    console.log('[Card Gen] Screenshot captured to buffer');

    // Use sharp to resize to exact dimensions and embed DPI metadata
    await sharp(screenshotBuffer)
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .withMetadata({ density: dpi })
        .toFile(outputPath);
    console.log(`[Card Gen] Screenshot saved: ${targetWidth}x${targetHeight}px at ${dpi} DPI to: ${outputPath}`);
}

/**
 * Generate an asset from a template
 *
 * @param {Object} template - Template object from database { name, html_template, config }
 * @param {Object} params - Parameters for rendering (animal data, rescue data, etc.)
 * @returns {Promise<string>} - Path to generated output file
 */
async function generateFromTemplate(template, params) {
    const config = typeof template.config === 'string'
        ? JSON.parse(template.config)
        : template.config;

    console.log(`[Card Gen] Starting generation with template: ${template.name}`);
    console.log(`[Card Gen] Config:`, JSON.stringify(config, null, 2));

    // Launch browser
    const { launchBrowser } = require('./browser-helper.js');
    const browser = await launchBrowser();
    console.log('[Card Gen] Browser launched');

    const page = await browser.newPage();
    console.log('[Card Gen] New page created');

    // Create temp directory with assets
    const { tmpPath, cleanup } = await createTempDir();
    console.log('[Card Gen] Temp directory ready');

    // Preprocess parameters
    const processedParams = await preprocessParams(params, config);

    // Render template to HTML file
    const htmlFilename = `${template.name}.html`;
    await renderTemplate(template.html_template, tmpPath, htmlFilename, processedParams);
    console.log('[Card Gen] HTML template processed');

    // Set viewport based on template config
    const viewport = calculateViewport(config);
    await page.setViewport(viewport);
    console.log(`[Card Gen] Viewport set: ${viewport.width}x${viewport.height} (${config.dpi || DEFAULT_DPI} DPI)`);

    // Load rendered HTML
    const htmlPath = `file://${path.join(tmpPath, htmlFilename)}`;
    console.log('[Card Gen] Loading page:', htmlPath);
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    console.log('[Card Gen] Page loaded');

    // Ensure output directory exists
    const outputDir = getOutputDir();
    console.log('[Card Gen] Creating output directory:', outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    // Generate output filename from pattern
    const outputPattern = config.outputNamePattern || '{name}-{templateName}.png';
    const outputFilename = outputPattern
        .replace('{name}', params.name || 'unnamed')
        .replace('{templateName}', template.name);
    const outputPath = path.join(outputDir, outputFilename);
    console.log('[Card Gen] Output path:', outputPath);

    // Capture screenshot
    await capture(page, outputPath, config);

    // Cleanup
    console.log('[Card Gen] Closing browser...');
    await browser.close();
    console.log('[Card Gen] Cleaning up temp directory...');
    await cleanup();
    console.log('[Card Gen] Generation complete!');

    return outputPath;
}

// ============================================================
// Legacy API - maintained for backwards compatibility
// ============================================================

/**
 * Default configuration for card-front template
 */
const CARD_FRONT_CONFIG = {
    pageWidthInches: 11,
    pageHeightInches: 8.5,
    orientation: 'landscape',
    paperSize: 'letter',
    dpi: DEFAULT_DPI,
    preprocessing: {
        generateQrCode: false,
        convertBooleans: true,
        booleanFields: ['shots', 'housetrained'],
        triStateFields: ['kids', 'dogs', 'cats']
    },
    outputNamePattern: '{name}-card-front.png'
};

/**
 * Default configuration for card-back template
 */
const CARD_BACK_CONFIG = {
    pageWidthInches: 11,
    pageHeightInches: 8.5,
    orientation: 'landscape',
    paperSize: 'letter',
    dpi: DEFAULT_DPI,
    preprocessing: {
        generateQrCode: true,
        qrCodeField: 'qrcode',
        qrCodeSource: 'slug',
        convertBooleans: true,
        booleanFields: ['shots', 'housetrained'],
        triStateFields: ['kids', 'dogs', 'cats']
    },
    outputNamePattern: '{name}-card-back.png'
};

/**
 * Generate card front (legacy API)
 * @param {Object} params - Animal/render parameters
 * @param {number} dpi - Target DPI (optional, default 360)
 * @returns {Promise<string>} - Path to generated PNG
 */
async function generateCardFront(params, dpi = DEFAULT_DPI) {
    // Try to load template from database first
    let template;
    try {
        const db = require('./db.js');
        if (db.isConnected()) {
            template = db.getTemplateByName('card-front');
        }
    } catch (err) {
        console.log('[Card Gen] Database not available, using built-in template');
    }

    if (!template) {
        // Use built-in template from file
        const templatePath = path.join(__dirname, 'templates', 'cards', 'card-front.html');
        const htmlTemplate = await fs.readFile(templatePath, 'utf8');
        // Convert legacy ~variable~ syntax to Handlebars {{variable}}
        const handlebarsTemplate = htmlTemplate.replace(/~(\w+)~/g, '{{$1}}');

        template = {
            name: 'card-front',
            html_template: handlebarsTemplate,
            config: { ...CARD_FRONT_CONFIG, dpi }
        };
    } else {
        // Override DPI if specified
        if (dpi !== DEFAULT_DPI) {
            template.config = { ...template.config, dpi };
        }
    }

    return generateFromTemplate(template, params);
}

/**
 * Generate card back (legacy API)
 * @param {Object} params - Animal/render parameters
 * @param {number} dpi - Target DPI (optional, default 360)
 * @returns {Promise<string>} - Path to generated PNG
 */
async function generateCardBack(params, dpi = DEFAULT_DPI) {
    // Try to load template from database first
    let template;
    try {
        const db = require('./db.js');
        if (db.isConnected()) {
            template = db.getTemplateByName('card-back');
        }
    } catch (err) {
        console.log('[Card Gen] Database not available, using built-in template');
    }

    if (!template) {
        // Use built-in template from file
        const templatePath = path.join(__dirname, 'templates', 'cards', 'card-back.html');
        const htmlTemplate = await fs.readFile(templatePath, 'utf8');
        // Convert legacy ~variable~ syntax to Handlebars {{variable}}
        const handlebarsTemplate = htmlTemplate.replace(/~(\w+)~/g, '{{$1}}');

        template = {
            name: 'card-back',
            html_template: handlebarsTemplate,
            config: { ...CARD_BACK_CONFIG, dpi }
        };
    } else {
        // Override DPI if specified
        if (dpi !== DEFAULT_DPI) {
            template.config = { ...template.config, dpi };
        }
    }

    return generateFromTemplate(template, params);
}

// Export functions for direct use in Electron
module.exports = {
    // New generic API
    generateFromTemplate,
    preprocessParams,
    calculateViewport,

    // Legacy API (backwards compatible)
    generateCardFront,
    generateCardBack,
    DEFAULT_DPI
};

// CLI execution - only run if called directly (not required as a module)
if (require.main === module) {
    (async () => {
        try {
            // Read JSON from stdin or command line argument
            const args = process.argv.slice(2);
            console.log('[Card Gen] Command line args:', args);
            let params;
            let templateName = 'card-front'; // default

            if (args.length > 0) {
                console.log('[Card Gen] Reading parameters from command line argument');
                console.log('[Card Gen] Raw arg[0]:', args[0]);
                params = JSON.parse(args[0]);
                console.log('[Card Gen] Parsed parameters:', JSON.stringify(params, null, 2));

                // Check if second argument specifies template name
                if (args.length > 1) {
                    templateName = args[1];
                    // Support legacy 'front'/'back' arguments
                    if (templateName === 'front') templateName = 'card-front';
                    if (templateName === 'back') templateName = 'card-back';
                    console.log('[Card Gen] Template specified:', templateName);
                }
            } else {
                console.log('[Card Gen] Reading parameters from stdin');
                const stdin = await new Promise((resolve) => {
                    let data = '';
                    process.stdin.on('data', chunk => data += chunk);
                    process.stdin.on('end', () => resolve(data));
                });
                console.log('[Card Gen] Stdin data:', stdin);
                params = JSON.parse(stdin);
                console.log('[Card Gen] Parsed parameters:', JSON.stringify(params, null, 2));
            }

            // Try to load template from database
            let template;
            try {
                const db = require('./db.js');
                await db.initializeAsync();
                template = db.getTemplateByName(templateName);
            } catch (err) {
                console.log('[Card Gen] Could not load from database:', err.message);
            }

            let outputPath;
            if (template) {
                outputPath = await generateFromTemplate(template, params);
            } else {
                // Fallback to legacy functions
                if (templateName === 'card-back') {
                    outputPath = await generateCardBack(params);
                } else {
                    outputPath = await generateCardFront(params);
                }
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
