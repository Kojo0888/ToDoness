// Renders the PNG icons from the SVG files with the browser that is already installed.
// Run once (`node scripts/make-icons.cjs`); the PNGs are committed.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', 'public');
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'apple-touch-icon.png', 180],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];

(async () => {
  const browser = await chromium.launch();
  for (const [svg, png, size] of jobs) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const data = fs.readFileSync(path.join(pub, svg), 'utf8');
    await page.setContent(
      `<body style="margin:0;background:transparent">${data.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`,
    );
    await page.screenshot({
      path: path.join(pub, png),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
  }
  await browser.close();
  console.log('icons written');
})();
