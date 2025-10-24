const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// Minimal static file server for the repo root used during tests.
function createStaticServer(root) {
  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let fsPath = path.join(root, urlPath);
      // If URL ends with '/', serve index.html
      if (urlPath.endsWith('/')) fsPath = path.join(root, urlPath, 'index.html');
      // If path is directory, try index.html
      if (fs.existsSync(fsPath) && fs.statSync(fsPath).isDirectory()) fsPath = path.join(fsPath, 'index.html');
      if (!fs.existsSync(fsPath)) {
        // fallback to index.html for SPA behaviour
        fsPath = path.join(root, 'index.html');
      }
      const ext = path.extname(fsPath).toLowerCase();
      const ct = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg'
      }[ext] || 'application/octet-stream';
      const stream = fs.createReadStream(fsPath);
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
      stream.pipe(res);
      stream.on('error', () => res.end());
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('server error');
    }
  });
}

async function runTest() {
  const server = createStaticServer(ROOT);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('Test server running at http://localhost:' + PORT);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  // Capture console messages to help debugging when the test runs
  page.on('console', msg => {
    const args = msg.args ? msg.args.map(a => a.toString()) : [msg.text()];
    console.log('[page]', msg.type(), args.join(' '));
  });

  try {
    const url = `http://localhost:${PORT}/#draft`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    // Wait for main to render sections
    await page.waitForSelector('main section', { timeout: 10000 });

    // Find the first inflection link and the iframe
    const info = await page.evaluate(() => {
      const first = document.querySelector('main a:not(.dontinflect)');
      const iframe = document.getElementById('if');
      return {
        firstHref: first ? (new URL(first.getAttribute('href') || first.href, window.location.href).href) : null,
        iframeSrc: iframe ? iframe.getAttribute('src') || iframe.src || null : null
      };
    });

    console.log('First inflection href resolved to:', info.firstHref);
    console.log('Initial iframe src (may be null):', info.iframeSrc);

    // Wait up to 6s for the iframe to load the expected href (accounting for retry)
    const success = await page.waitForFunction((expected) => {
      const ifr = document.getElementById('if');
      if (!expected) return false;
      if (!ifr) return false;
      try {
        const cur = ifr.getAttribute('src') || ifr.src || '';
        // normalized-ish check: expected should be contained in src
        return cur && cur.indexOf(expected) !== -1;
      } catch (e) { return false; }
    }, { polling: 200, timeout: 6000 }, info.firstHref).catch(() => false);

    if (!success) {
      // Dump some diagnostics
      const iframeSrcNow = await page.evaluate(() => {
        const ifr = document.getElementById('if'); return ifr ? (ifr.getAttribute('src') || ifr.src || '') : '';
      });
      console.error('FAIL: iframe did not load expected href. iframe.src=', iframeSrcNow);
      throw new Error('iframe failed to load expected href');
    }

  console.log('PASS: iframe loaded the expected resource for the first link');

    // Section-by-section verification: for each section, find its first inflection
    // link, scroll that section into view (to trigger observers and snapping), and
    // assert that the iframe src reflects that link.
    const items = await page.evaluate(() => {
      const secs = Array.from(document.querySelectorAll('main section'));
      const out = [];
      for (let i = 0; i < secs.length; i++) {
        const sec = secs[i];
        const a = sec.querySelector('a:not(.dontinflect)');
        if (!a) continue;
        const raw = a.getAttribute('href') || a.href;
        if (!raw) continue;
        const href = new URL(raw, window.location.href).href;
        out.push({ index: i, href });
      }
      return out;
    });

    console.log('Found', items.length, 'sections with inflection links');
    let failures = [];

    for (let i = 0; i < items.length; i++) {
      const { index, href } = items[i];
      console.log(`→ Checking section ${index} expects`, href);
      // Scroll the section to center to mimic real navigation
      await page.evaluate((secIdx) => {
        const secs = Array.from(document.querySelectorAll('main section'));
        const sec = secs[secIdx];
        if (!sec) return;
        const scroller = document.querySelector('main') || document.scrollingElement || document.documentElement;
        const viewportHeight = (scroller && scroller.clientHeight) || window.innerHeight;
        const top = sec.getBoundingClientRect().top + (scroller ? scroller.scrollTop : (window.pageYOffset || 0));
        const centeredTop = top - (viewportHeight / 2) + (sec.offsetHeight / 2);
        if (scroller === document.scrollingElement || scroller === document.documentElement) {
          window.scrollTo(0, centeredTop);
        } else {
          scroller.scrollTo(0, centeredTop);
        }
      }, index);

      // Allow time for observers and any smooth scroll to act
      await page.waitForTimeout(300);

      const ok = await page.waitForFunction((expected) => {
        const ifr = document.getElementById('if');
        if (!ifr) return false;
        const cur = ifr.getAttribute('src') || ifr.src || '';
        return cur && cur.indexOf(expected) !== -1;
      }, { polling: 200, timeout: 4000 }, href).catch(() => false);

      if (!ok) {
        const iframeSrcNow = await page.evaluate(() => { const ifr = document.getElementById('if'); return ifr ? (ifr.getAttribute('src') || ifr.src || '') : ''; });
        console.error(`FAIL: section ${index} expected iframe to include`, href, 'but got', iframeSrcNow);
        failures.push({ index, expected: href, got: iframeSrcNow });
      } else {
        console.log(`PASS: section ${index} updated iframe to`, href);
      }
    }

    if (failures.length) {
      console.error('E2E mismatches detected:', failures);
      throw new Error(`Iframe mismatches: ${failures.length} failures`);
    }

    await browser.close();
    server.close();
    console.log('Test completed successfully');
    process.exit(0);
  } catch (err) {
    try { console.error('Test error:', err && err.message); } catch(e){}
    try { await browser.close(); } catch(e){}
    try { server.close(); } catch(e){}
    process.exit(2);
  }
}

runTest();
