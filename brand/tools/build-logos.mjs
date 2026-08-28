import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SVG_DIR = path.join(ROOT, "svg");
const PNG_DIR = path.join(ROOT, "png");

const INK = "#0A0A09"; // near-black
const BONE = "#E9E6DD"; // off-white
const AMBER = "#EEA02B"; // signal amber
const COBALT = "#2954FF"; // cobalt

function loadFont(p) {
  const buf = fs.readFileSync(p);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const FONT_DIR = path.join(import.meta.dirname, "geist/geist-font/Geist/ttf");
const semibold = loadFont(path.join(FONT_DIR, "Geist-SemiBold.ttf"));
const regular = loadFont(path.join(FONT_DIR, "Geist-Regular.ttf"));

// Outline a string to a single SVG path `d`, with tracking in em units.
// Returns { d, width } positioned with baseline at y, starting at x.
function textPath(font, text, size, x, y, trackingEm = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  let cx = x;
  let d = "";
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    d += g.getPath(cx, y, size).toPathData(3);
    cx += g.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      const k = font.getKerningValue(g, glyphs[i + 1]);
      cx += (Number.isFinite(k) ? k : 0) * scale;
      cx += trackingEm * size;
    }
  }
  return { d, width: cx - x };
}

// ---------- Marks (all on a 64x64 grid) ----------

// A — SIGNAL Q: gapped ring + 45° breakout line reading as the Q tail.
// Ring: center (29,29) r=20, gap centered on 45°, ±20°.
function markA(ring = BONE, tail = AMBER) {
  const cx = 29, cy = 29, r = 20;
  const p = (deg) =>
    `${(cx + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(cy + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  return `
  <path d="M ${p(65)} A ${r} ${r} 0 1 1 ${p(25)}" fill="none" stroke="${ring}" stroke-width="7"/>
  <path d="M25.5 25.5 L55.5 55.5" stroke="${tail}" stroke-width="7"/>`;
}

// B — TICK: thin square frame crossed by an impulse waveform.
function markB(frame = BONE, pulse = COBALT) {
  return `
  <rect x="7" y="7" width="50" height="50" fill="none" stroke="${frame}" stroke-width="3"/>
  <path d="M2 40 L21.5 40 L29.5 15 L37.5 47 L43 40 L62 40" fill="none" stroke="${pulse}" stroke-width="5" stroke-linejoin="miter" stroke-miterlimit="8"/>`;
}

// C — BLOCK Q: full ring + detached solid square tail on the 45° axis.
function markC(color = BONE) {
  return `
  <circle cx="28" cy="28" r="20" fill="none" stroke="${color}" stroke-width="7"/>
  <rect x="47" y="47" width="12" height="12" fill="${color}"/>`;
}

function markSvg(inner, size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${inner}\n</svg>`;
}

// ---------- Wordmarks ----------
// Baseline grid: wordmark height ~ cap height of Geist at chosen size.

function wordmark(spec) {
  // spec: [{text, font, color, trackingEm}], size, gap between segments (px)
  const size = spec.size;
  const y = size; // baseline
  let x = 0;
  const parts = [];
  for (const seg of spec.segments) {
    const t = textPath(seg.font, seg.text, size, x, y, seg.trackingEm ?? 0);
    parts.push(`<path d="${t.d}" fill="${seg.color}"/>`);
    x += t.width + (seg.gapAfter ?? 0);
  }
  const capH = size * 0.72; // Geist cap height ratio approx
  const pad = size * 0.06;
  return {
    inner: parts.join("\n"),
    width: x,
    height: size * 1.28,
    viewBox: `0 ${size - capH - pad} ${x} ${capH + pad * 2}`,
    vbY: size - capH - pad,
    vbH: capH + pad * 2,
  };
}

function wordmarkSvg(w) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${w.viewBox}" width="${w.width.toFixed(1)}" height="${w.vbH.toFixed(1)}">${w.inner}</svg>`;
}

// ---------- Lockups (mark + wordmark, horizontal) ----------
function lockupSvg(markInner, w, markScale) {
  // 64-grid mark scaled so its optical height matches wordmark cap height * 1.5
  const markSize = w.vbH * 1.55;
  const s = markSize / 64;
  const gap = markSize * 0.34;
  const totalW = markSize + gap + w.width;
  const totalH = markSize;
  // vertically center wordmark against mark
  const wy = (totalH - w.vbH) / 2 - w.vbY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(1)} ${totalH.toFixed(1)}" width="${totalW.toFixed(1)}" height="${totalH.toFixed(1)}">
<g transform="scale(${s.toFixed(4)})">${markInner}</g>
<g transform="translate(${(markSize + gap).toFixed(1)} ${wy.toFixed(1)})">${w.inner}</g>
</svg>`;
}

// ---------- Build all three directions ----------
const S = 100; // wordmark font size base

const directions = {
  "a-signal": {
    mark: markA(),
    markMono: markA(BONE, BONE),
    word: wordmark({
      size: S,
      segments: [
        { text: "QUANT", font: semibold, color: BONE, trackingEm: -0.015, gapAfter: S * 0.26 },
        { text: "AI", font: semibold, color: AMBER, trackingEm: -0.015 },
      ],
    }),
  },
  "b-pulse": {
    mark: markB(),
    markMono: markB(BONE, BONE),
    word: wordmark({
      size: S,
      segments: [
        { text: "QUANT", font: semibold, color: BONE, trackingEm: -0.01, gapAfter: S * 0.26 },
        { text: "AI", font: semibold, color: COBALT, trackingEm: -0.01 },
      ],
    }),
  },
  "c-block": {
    mark: markC(),
    markMono: markC(BONE),
    word: wordmark({
      size: S,
      segments: [
        { text: "QUANT", font: regular, color: BONE, trackingEm: 0.06, gapAfter: S * 0.3 },
        { text: "AI", font: regular, color: BONE, trackingEm: 0.06 },
      ],
    }),
  },
};

fs.mkdirSync(SVG_DIR, { recursive: true });
fs.mkdirSync(PNG_DIR, { recursive: true });

async function renderPng(svg, outPath, width, height) {
  await sharp(Buffer.from(svg), { density: 400 })
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
}

for (const [name, d] of Object.entries(directions)) {
  const mark = markSvg(d.mark);
  const wsvg = wordmarkSvg(d.word);
  const lockup = lockupSvg(d.mark, d.word);

  fs.writeFileSync(path.join(SVG_DIR, `${name}-mark.svg`), mark);
  fs.writeFileSync(path.join(SVG_DIR, `${name}-wordmark.svg`), wsvg);
  fs.writeFileSync(path.join(SVG_DIR, `${name}-lockup.svg`), lockup);

  await renderPng(mark, path.join(PNG_DIR, `${name}-mark-512.png`), 512, 512);
  await renderPng(mark, path.join(PNG_DIR, `${name}-mark-1024.png`), 1024, 1024);

  // favicons: mark on solid near-black tile
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${INK}"/><g transform="translate(6.4 6.4) scale(0.8)">${d.mark}</g></svg>`;
  await renderPng(tile, path.join(PNG_DIR, `${name}-favicon-32.png`), 32, 32);
  await renderPng(tile, path.join(PNG_DIR, `${name}-favicon-64.png`), 64, 64);

  // horizontal lockup banner PNG, transparent, 1600 wide
  const lw = 1600;
  const ratio = parseFloat(lockup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)[2]) /
    parseFloat(lockup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)[1]);
  await renderPng(lockup, path.join(PNG_DIR, `${name}-lockup-1600.png`), lw, Math.round(lw * ratio));
}

console.log("done");
console.log(fs.readdirSync(SVG_DIR).join("\n"));
console.log(fs.readdirSync(PNG_DIR).join("\n"));
