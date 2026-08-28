import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
for (let i = 0; i < 20; i++) {
  try { await page.goto("http://localhost:3311/style-guide", { waitUntil: "networkidle0", timeout: 8000 }); break; }
  catch { await new Promise(r => setTimeout(r, 1000)); }
}
const OUT = "/private/tmp/claude-501/-Users-MAC-quantai/3d5a62e4-98c8-47a7-8283-f6d7c4e3b8b9/scratchpad/";
// full page in slices
const h = await page.evaluate(() => document.body.scrollHeight);
console.log("page height", h);
let n = 0;
for (let y = 0; y < h && n < 6; y += 950, n++) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await new Promise(r => setTimeout(r, 350));
  await page.screenshot({ path: OUT + "sg-" + n + ".png" });
}
await page.goto("http://localhost:3311/", { waitUntil: "networkidle0" });
await page.screenshot({ path: OUT + "home.png" });
await browser.close();
console.log("shots:", n + 1);
