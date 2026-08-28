import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
const OUT = "/private/tmp/claude-501/-Users-MAC-quantai/3d5a62e4-98c8-47a7-8283-f6d7c4e3b8b9/scratchpad/";
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
await page.goto("http://localhost:3311/", { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 1200)); // let hero stagger finish
const h = await page.evaluate(() => document.body.scrollHeight);
console.log("height", h);
let n = 0;
for (let y = 0; y < h && n < 7; y += 900, n++) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: OUT + "land-" + n + ".png" });
}
// mobile
const m = await browser.newPage();
await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await m.goto("http://localhost:3311/", { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 1200));
await m.screenshot({ path: OUT + "land-mobile-0.png" });
await m.evaluate(() => window.scrollTo(0, 1400));
await new Promise(r => setTimeout(r, 500));
await m.screenshot({ path: OUT + "land-mobile-1.png" });
await browser.close();
console.log("done", n);
