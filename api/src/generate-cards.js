const puppeteer = require('puppeteer');
const path = require('path');

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
    await page.setViewport({
        width:1920,
        height:1080,
        deviceScaleFactor: 2
    })

    await page.goto(`file://${path.join(process.cwd(), 'src/card-front.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, "card-front");

    await page.goto(`file://${path.join(process.cwd(), 'src/card-back.html')}`, { waitUntil: 'networkidle0' });
    await capture(page, "card-back");

    await browser.close();
})();

