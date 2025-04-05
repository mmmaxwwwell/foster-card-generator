const puppeteer = require('puppeteer');
const tmp = require('tmp');
const fs = require('fs').promises;
const rimraf = require('rimraf');
const path = require('path');
const yaml = require('js-yaml');
const fsSync = require('fs');
const QRCode = require('qrcode');
const Handlebars = require('handlebars');
async function createTempDir(params) {
    return new Promise((resolve, reject) => {
        tmp.dir({ prefix: 'foster-card-', tmpdir: '/tmp' }, (err, tmpPath, cleanupCallback) => {
            if (err) {
                reject(err);
            } else {
                fsSync.mkdirSync(path.join(tmpPath, 'images'), { recursive: true });
                const assets = ['card.css', 'images/' + params.portraitPath , 'qr.svg', 'logo.png', 'qrcode.min.js']; // add more asset filenames as needed
                Promise.all(
                    assets.map(asset =>
                        fs.copyFile(
                            path.join(process.cwd(), "src", asset),
                            path.join(tmpPath, asset)
                        )
                    )
                )
                .then(() => {
                    resolve({ tmpPath: tmpPath, cleanup: () => new Promise(res => rimraf(tmpPath, res)) });
                })
                .catch(err => reject(err));
            }
        });
    });
}

async function replaceParametersInHtml(fileName, outputPath, params) {
    // Read template
    const source = await fs.readFile(path.join(process.cwd(), 'src', fileName), 'utf8');

    // Generate QR code if needed
    if (fileName === 'card-back.html') {
        try {
            params.qrcode = await QRCode.toDataURL(params.slug || params.adoptionUrl);
        } catch (err) {
            console.error('Error generating QR code:', err);
            params.qrcode = `https://chart.googleapis.com/chart?chs=128x128&cht=qr&chl=${encodeURIComponent(params.slug || params.adoptionUrl)}`;
        }
        
        // Add cards array for the loop (10 cards)
        params.cards = Array(10).fill({});
    }

    // Process boolean values
    const processedParams = { ...params };
    for (const key in processedParams) {
        if (typeof processedParams[key] === 'boolean') {
            processedParams[key] = processedParams[key] ? "✅" : "❌";
        } else if (processedParams[key] === 1) {
            processedParams[key] = "✅";
        } else if (processedParams[key] === 0) {
            processedParams[key] = "❌";
        }
    }

    // Register a helper to maintain compatibility with the ~variable~ syntax
    Handlebars.registerHelper('tilde', function(context) {
        return new Handlebars.SafeString('~' + context + '~');
    });

    // Convert ~variable~ syntax to Handlebars syntax {{variable}}
    const handlebarsTemplate = source.replace(/~(\w+)~/g, '{{$1}}');

    // Compile and render template
    const template = Handlebars.compile(handlebarsTemplate);
    const result = template(processedParams);

    await fs.writeFile(path.join(outputPath, fileName), result, 'utf8');
}

async function capture(page, divName) {
    const div = await page.$("#page");
    const bounding_box = await div.boundingBox();
    await page.screenshot({
        path: "output/" + divName + ".jpg",
        clip: {
            x: bounding_box.x,
            y: bounding_box.y,
            width: bounding_box.width,
            height: bounding_box.height
        },
        type: 'jpeg',
        quality: 80 // You can adjust quality from 0-100
    });
}

async function generateCard(params) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    let {tmpPath, cleanup} = await createTempDir(params);

    await replaceParametersInHtml("card-front.html", tmpPath, params)
    await replaceParametersInHtml("card-back.html", tmpPath, params)

    await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2
    })

    await page.goto(`file://${path.join(tmpPath, 'card-front.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, `${params.name}-card-front`);

    await page.goto(`file://${path.join(tmpPath, 'card-back.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, `${params.name}-card-back`);

    await browser.close();

    await cleanup();
}

(async () => {
    const dogDir = path.join(process.cwd(), 'src', 'dogs.d');
    const dogFiles = await fs.readdir(dogDir);

    const dogParams = await Promise.all(dogFiles.map(async file => {
        const filePath = path.join(dogDir, file);
        const fileContents = await fs.readFile(filePath, 'utf8');
        return yaml.load(fileContents);
    }));

    for (const params of dogParams) {
        await generateCard(params);
    }
})();

