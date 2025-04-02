const puppeteer = require('puppeteer');

const tmp = require('tmp');
const fs = require('fs').promises;
const rimraf = require('rimraf');
const path = require('path');

async function createTempDir() {
    return new Promise((resolve, reject) => {
        tmp.dir({ prefix: 'foster-card-', tmpdir: '/tmp' }, (err, tmpPath, cleanupCallback) => {
            if (err) {
                reject(err);
            } else {
                const assets = ['card.css', 'portrait.jpeg', 'qr.svg', 'logo.png']; // add more asset filenames as needed
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
    let content = await fs.readFile(path.join(process.cwd(), 'src', fileName), 'utf8');
    for (const key in params) {
        const regex = new RegExp(`~${key}~`, 'g');
        if (typeof params[key] === 'boolean') {
            params[key] = params[key] ? "✅" : "❌";
        }
        content = content.replace(regex, params[key]);
    }
    await fs.writeFile(path.join(outputPath, fileName) , content, 'utf8');
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

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    let {tmpPath} = await createTempDir();

    let params = {
        name: "Doug",
        slug: "example.com",
        size: "Medium",
        shots: true,
        housetrained: true,
        breed: "Heeler",
        ageLong: "6 Months",
        ageShort: "6 Mo",
        gender: "Neutered(M)",
        kids: true,
        dogs: true,
        cats: false,
        portraitPath: "./portrait.jpeg"
    }

    await replaceParametersInHtml("card-front.html", tmpPath, params)
    await replaceParametersInHtml("card-back.html", tmpPath, params)
    
    await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2
    })

    await page.goto(`file://${path.join(tmpPath, 'card-front.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, "card-front");

    await page.goto(`file://${path.join(tmpPath, 'card-back.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, "card-back");

    await browser.close();
})();

