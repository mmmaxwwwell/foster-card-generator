const { launchBrowser } = require('./browser-helper.js');

/**
 * Discovery tool: navigates to an Adoptapet pet page and logs every
 * network request/response so we can find the JSON API that hydrates
 * viewData. Run with:
 *   node app/scrape-discover-adoptapet.js <pet-url>
 */
async function discover(url) {
    const browser = await launchBrowser({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
        ]
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const interesting = [];

    page.on('response', async (response) => {
        const req = response.request();
        const reqUrl = response.url();
        const method = req.method();
        const status = response.status();
        const ct = (response.headers()['content-type'] || '').toLowerCase();
        const resourceType = req.resourceType();

        // Skip obvious static asset noise
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) return;
        if (/\.(png|jpe?g|gif|webp|svg|ico|css|woff2?)(\?|$)/i.test(reqUrl)) return;

        const isJson = ct.includes('application/json') || ct.includes('+json');
        const isHtml = ct.includes('text/html');
        const isXhrFetch = resourceType === 'xhr' || resourceType === 'fetch';

        if (!isJson && !isXhrFetch && !isHtml) return;

        let bodyPreview = '';
        let bodyLen = 0;
        try {
            const text = await response.text();
            bodyLen = text.length;
            bodyPreview = text.slice(0, 400).replace(/\s+/g, ' ');
        } catch (_) {
            // body unavailable (redirect, navigation, etc.)
        }

        interesting.push({
            method,
            status,
            resourceType,
            contentType: ct,
            url: reqUrl,
            bodyLen,
            bodyPreview,
            mentionsViewData: bodyPreview.includes('viewData') || bodyPreview.includes('petName'),
        });
    });

    console.error('[Discover] Navigating:', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000));

    // Also scan the final DOM HTML for viewData / petName signatures
    const pageHtml = await page.content();
    const hasViewDataInHtml = pageHtml.includes('viewData');
    const hasPetNameInHtml = pageHtml.includes('petName');

    console.log(JSON.stringify({
        pageUrl: page.url(),
        hasViewDataInHtml,
        hasPetNameInHtml,
        htmlLen: pageHtml.length,
        requests: interesting,
    }, null, 2));

    await browser.close();
}

if (require.main === module) {
    const url = process.argv[2];
    if (!url) {
        console.error('Usage: node scrape-discover-adoptapet.js <pet-url>');
        process.exit(1);
    }
    discover(url).catch(e => { console.error(e); process.exit(1); });
}
