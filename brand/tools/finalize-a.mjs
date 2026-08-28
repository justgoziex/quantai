import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const FINAL = path.join(ROOT, "final");
fs.mkdirSync(path.join(FINAL, "svg"), { recursive: true });
fs.mkdirSync(path.join(FINAL, "png"), { recursive: true });

const INK = "#0A0A09", BONE = "#E9E6DD", AMBER = "#EEA02B";

function loadFont(p) {
  const buf = fs.readFileSync(p);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const semibold = loadFont(path.join(import.meta.dirname, "geist/geist-font/Geist/ttf/Geist-SemiBold.ttf"));

function textPath(font, text, size, x, y, trackingEm = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  let cx = x, d = "";
  for (let i = 0; i < glyphs.length; i++) {
    d += glyphs[i].getPath(cx, y, size).toPathData(3);
    cx += glyphs[i].advanceWidth * scale;
    if (i < glyphs.length - 1) {
      const k = font.getKerningValue(glyphs[i], glyphs[i + 1]);
      cx += (Number.isFinite(k) ? k : 0) * scale + trackingEm * size;
    }
  }
  return { d, width: cx - x };
}

const pt = (cx, cy, r, deg) => `${(cx + r * Math.cos(deg * Math.PI / 180)).toFixed(2)} ${(cy + r * Math.sin(deg * Math.PI / 180)).toFixed(2)}`;
const mark = (ring, tail) =>
  `<path d="M ${pt(29,29,20,65)} A 20 20 0 1 1 ${pt(29,29,20,25)}" fill="none" stroke="${ring}" stroke-width="7"/><path d="M25.5 25.5 L55.5 55.5" stroke="${tail}" stroke-width="7"/>`;
const markSvg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`;

// Wordmark: QUANT in bone + AI in amber, Geist SemiBold, -1.5% tracking
const S = 100;
const seg1 = textPath(semibold, "QUANT", S, 0, S, -0.015);
const gap = S * 0.26;
const seg2 = textPath(semibold, "AI", S, seg1.width + gap, S, -0.015);
const wWidth = seg1.width + gap + seg2.width;
const capH = S * 0.72, pad = S * 0.06;
const vbY = S - capH - pad, vbH = capH + pad * 2;
const wordInner = (c1, c2) => `<path d="${seg1.d}" fill="${c1}"/><path d="${seg2.d}" fill="${c2}"/>`;
const wordSvg = (c1, c2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${vbY} ${wWidth.toFixed(1)} ${vbH.toFixed(1)}" width="${wWidth.toFixed(1)}" height="${vbH.toFixed(1)}">${wordInner(c1, c2)}</svg>`;

function lockupSvg(markInner, wc1, wc2) {
  const markSize = vbH * 1.55, s = markSize / 64, g = markSize * 0.34;
  const totalW = markSize + g + wWidth, totalH = markSize;
  const wy = (totalH - vbH) / 2 - vbY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(1)} ${totalH.toFixed(1)}" width="${totalW.toFixed(1)}" height="${totalH.toFixed(1)}">
<g transform="scale(${s.toFixed(4)})">${markInner}</g>
<g transform="translate(${(markSize + g).toFixed(1)} ${wy.toFixed(1)})">${wordInner(wc1, wc2)}</g>
</svg>`;
}

const variants = {
  "quantai-mark": markSvg(mark(BONE, AMBER)),            // primary, for dark grounds
  "quantai-mark-mono": markSvg(mark(BONE, BONE)),        // single-color bone
  "quantai-mark-onlight": markSvg(mark(INK, AMBER)),     // for light grounds
  "quantai-wordmark": wordSvg(BONE, AMBER),
  "quantai-wordmark-onlight": wordSvg(INK, AMBER),
  "quantai-lockup": lockupSvg(mark(BONE, AMBER), BONE, AMBER),
  "quantai-lockup-onlight": lockupSvg(mark(INK, AMBER), INK, AMBER),
};

async function png(svgStr, out, w, h) {
  await sharp(Buffer.from(svgStr), { density: 400 })
    .resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(out);
}

for (const [name, s] of Object.entries(variants)) {
  fs.writeFileSync(path.join(FINAL, "svg", `${name}.svg`), s);
}

await png(variants["quantai-mark"], path.join(FINAL, "png", "quantai-mark-512.png"), 512, 512);
await png(variants["quantai-mark"], path.join(FINAL, "png", "quantai-mark-1024.png"), 1024, 1024);

const lockup = variants["quantai-lockup"];
const [vw, vh] = lockup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
await png(lockup, path.join(FINAL, "png", "quantai-lockup-1600.png"), 1600, Math.round(1600 * vh / vw));

const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${INK}"/><g transform="translate(6.4 6.4) scale(0.8)">${mark(BONE, AMBER)}</g></svg>`;
await png(tile, path.join(FINAL, "png", "quantai-favicon-32.png"), 32, 32);
await png(tile, path.join(FINAL, "png", "quantai-favicon-64.png"), 64, 64);
await png(tile, path.join(FINAL, "png", "quantai-appicon-512.png"), 512, 512);

console.log("final assets:");
console.log(fs.readdirSync(path.join(FINAL, "svg")).map(f => "svg/" + f).join("\n"));
console.log(fs.readdirSync(path.join(FINAL, "png")).map(f => "png/" + f).join("\n"));
