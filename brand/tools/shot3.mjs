import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
const OUT = "/private/tmp/claude-501/-Users-MAC-quantai/3d5a62e4-98c8-47a7-8283-f6d7c4e3b8b9/scratchpad/";
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });

// launch wizard: step 1 (chain)
await page.goto("http://localhost:3311/launch", { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: OUT + "q-launch-1.png" });

// pick BSC, continue → step 2, fill token fields
const btns = await page.$$("button");
for (const b of btns) {
  const t = await b.evaluate(el => el.textContent);
  if (t && t.includes("BNB Smart Chain")) { await b.click(); break; }
}
const clickByText = async (txt) => {
  for (const b of await page.$$("button")) {
    const t = await b.evaluate(el => el.textContent?.trim());
    if (t === txt) { await b.click(); return true; }
  }
  return false;
};
await clickByText("Continue");
await new Promise(r => setTimeout(r, 400));
// try continuing empty to capture validation
await clickByText("Continue");
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: OUT + "q-launch-2-validation.png" });
// fill
const inputs = await page.$$("input");
await inputs[0].type("Nocturne");
await inputs[1].type("NOCTA");
await clickByText("Continue");
await new Promise(r => setTimeout(r, 400));
// step 3: set sell tax to 12 to see score react
const nums = await page.$$('input[type="number"]');
await nums[1].click({ clickCount: 3 });
await nums[1].type("12");
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: OUT + "q-launch-3-economics.png" });
// back to 0 tax, lock 365
await nums[1].click({ clickCount: 3 });
await nums[1].type("0");
await clickByText("365d");
await clickByText("Continue");
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: OUT + "q-launch-4-review.png" });
// deploy simulation
await clickByText("Preview deployment");
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: OUT + "q-launch-5-deploying.png" });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: OUT + "q-launch-6-done.png" });

// legal + status + rewards + hero chain tags
for (const [p, name] of [["terms","q-terms"],["status","q-status"],["rewards","q-rewards"]]) {
  await page.goto("http://localhost:3311/" + p, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: OUT + name + ".png" });
}
await page.goto("http://localhost:3311/", { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: OUT + "q-hero-chains.png" });
await browser.close();
console.log("done");
