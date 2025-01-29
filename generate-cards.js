const puppeteer = require('puppeteer');
const path = require('path');

async function capture(page, divName) {
    const div = await page.$("#" + divName);
    const bounding_box = await div.boundingBox();
    await page.screenshot({
        path: "output/" +divName + ".png",
        clip: {
            x: bounding_box.x,
            y: bounding_box.y,
            width: bounding_box.width,
            height: bounding_box.height
        }
    });
}

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(`file://${path.join(process.cwd(), 'card.html')}`, { waitUntil: 'networkidle0' });

    await capture(page, "card-front");
    await capture(page, "card-back");

    await page.goto(`file://${path.join(process.cwd(), 'card-front-page.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, "card-front-page");
    await page.goto(`file://${path.join(process.cwd(), 'card-back-page.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, "card-back-page");

    await browser.close();
})();

