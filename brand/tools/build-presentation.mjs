import fs from "node:fs";
import path from "node:path";

const OUT = "/private/tmp/claude-501/-Users-MAC-quantai/3d5a62e4-98c8-47a7-8283-f6d7c4e3b8b9/scratchpad/quantai-logo-directions.html";
const FD = path.join(import.meta.dirname, "geist/geist-font");

const b64 = (p) => fs.readFileSync(p).toString("base64");
const geistReg = b64(path.join(FD, "Geist/webfonts/Geist-Regular.woff2"));
const geistSemi = b64(path.join(FD, "Geist/webfonts/Geist-SemiBold.woff2"));
const monoReg = b64(path.join(FD, "GeistMono/webfonts/GeistMono-Regular.woff2"));

const INK = "#0A0A09", BONE = "#E9E6DD", AMBER = "#EEA02B", COBALT = "#2954FF";

// mark geometry (same as build-logos.mjs)
const pt = (cx, cy, r, deg) => `${(cx + r * Math.cos(deg * Math.PI / 180)).toFixed(2)} ${(cy + r * Math.sin(deg * Math.PI / 180)).toFixed(2)}`;
const markA = (ring, tail) => `<path d="M ${pt(29,29,20,65)} A 20 20 0 1 1 ${pt(29,29,20,25)}" fill="none" stroke="${ring}" stroke-width="7"/><path d="M25.5 25.5 L55.5 55.5" stroke="${tail}" stroke-width="7"/>`;
const markB = (frame, pulse) => `<rect x="7" y="7" width="50" height="50" fill="none" stroke="${frame}" stroke-width="3"/><path d="M2 40 L21.5 40 L29.5 15 L37.5 47 L43 40 L62 40" fill="none" stroke="${pulse}" stroke-width="5" stroke-linejoin="miter" stroke-miterlimit="8"/>`;
const markC = (c) => `<circle cx="28" cy="28" r="20" fill="none" stroke="${c}" stroke-width="7"/><rect x="47" y="47" width="12" height="12" fill="${c}"/>`;

const svg = (inner, size, label) =>
  `<svg viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${label}">${inner}</svg>`;

function ladder(markFn, args, label) {
  return [64, 32, 16].map(s =>
    `<div class="rung"><div class="rung-box">${svg(markFn(...args), s, label + " at " + s + "px")}</div><span class="rung-cap">${s}px</span></div>`
  ).join("");
}

function tabMock(markFn, args, label) {
  return `<div class="tab" aria-hidden="true">
    <div class="tab-face">${svg(markFn(...args), 16, "")}<span>Quant AI — Screener</span><i>×</i></div>
  </div>`;
}

const directions = [
  {
    id: "A", slug: "a-signal", name: "Signal Q", accent: AMBER, accentName: "Signal Amber", accentHex: AMBER,
    markFn: markA, args: [BONE, AMBER], argsMono: [BONE, BONE],
    wordHtml: `<span class="wm wm-a">QUANT <b style="color:${AMBER}">AI</b></span>`,
    concept: "The Q is an open ring — a trading range. The tail is a straight line at 45° that starts inside the range and breaks out through the gap. One glyph, one story: the moment a signal leaves the noise.",
    type: "Geist SemiBold, −1.5% tracking. “AI” carries the amber so the accent has exactly one job in the lockup.",
    notes: "Strongest conceptual tie to the product. The amber stays legible on ink at 16px. Risk: the diagonal must always cross the ring — cropped tight, it could drift toward a search-glass read; the pass-through geometry is what prevents that.",
  },
  {
    id: "B", slug: "b-pulse", name: "The Tick", accent: COBALT, accentName: "Cobalt", accentHex: COBALT,
    markFn: markB, args: [BONE, COBALT], argsMono: [BONE, BONE],
    wordHtml: `<span class="wm wm-a">QUANT <b style="color:${COBALT}">AI</b></span>`,
    concept: "No letterform at all — an impulse crossing a frame. Flat baseline, one sharp spike, an overshoot, then back to baseline: how a real price event looks on an oscilloscope. The line ignores the frame’s edges, which is the point.",
    type: "Geist SemiBold, −1% tracking. Cobalt pulse against a bone frame; the wordmark stays quiet.",
    notes: "Most ownable as a pure symbol — nothing to confuse it with at any size. Reads instantly as “instrumentation,” not “crypto.” Risk: the waveform has a faint EKG association, and it gives up the Q entirely.",
  },
  {
    id: "C", slug: "c-block", name: "Block Q", accent: BONE, accentName: "Bone (mono)", accentHex: BONE,
    markFn: markC, args: [BONE], argsMono: [BONE],
    wordHtml: `<span class="wm wm-c">QUANT AI</span>`,
    concept: "A solid ring and a detached square on the 45° axis — a Q whose tail has left the body. The square is the outlier: the one data point outside the range that matters. Strictly monochrome; the identity runs on geometry and spacing alone.",
    type: "Geist Regular, +6% tracking, editorial caps. No second color anywhere — the restraint is the statement.",
    notes: "The most editorial and the quietest — closest to the Linear/Stripe school. Ages best, composes cleanly with any accent the product UI chooses later. Risk: quietest also means least distinctive at a glance; it asks the typography and layout of the site to carry more.",
  },
];

const sections = directions.map((d) => `
<section class="dir" id="dir-${d.id}">
  <div class="dir-head">
    <span class="dir-letter" style="color:${d.accent === BONE ? BONE : d.accent}">${d.id}</span>
    <div>
      <h2>${d.name}</h2>
      <p class="dir-sub">${d.concept}</p>
    </div>
  </div>
  <div class="dir-grid">
    <div class="col-info">
      <div class="spec">
        <span class="spec-label">Palette</span>
        <div class="chips">
          <span class="chip"><i style="background:${INK}"></i>Ink ${INK}</span>
          <span class="chip"><i style="background:${BONE}"></i>Bone ${BONE}</span>
          ${d.accentHex !== BONE ? `<span class="chip"><i style="background:${d.accentHex}"></i>${d.accentName} ${d.accentHex}</span>` : `<span class="chip chip-mute">single color — no accent</span>`}
        </div>
      </div>
      <div class="spec"><span class="spec-label">Wordmark</span><p>${d.type}</p></div>
      <div class="spec"><span class="spec-label">Honest read</span><p>${d.notes}</p></div>
      <div class="spec"><span class="spec-label">Files</span>
        <p class="files">brand/svg/${d.slug}-{mark, wordmark, lockup}.svg<br>brand/png/${d.slug}-mark-{512, 1024}.png<br>brand/png/${d.slug}-lockup-1600.png · favicon-{32, 64}.png</p>
      </div>
    </div>
    <div class="col-spec">
      <div class="panel panel-hero">${svg(d.markFn(...d.args), 168, d.name + " mark")}</div>
      <div class="panel panel-lockup">${svg(d.markFn(...d.args), 44, "")}${d.wordHtml}</div>
      <div class="panel panel-ladder">
        <div class="rungs">${ladder(d.markFn, d.args, d.name)}</div>
        ${tabMock(d.markFn, d.args, d.name)}
      </div>
    </div>
  </div>
</section>`).join("\n");

const html = `<title>Quant AI — Logo Directions</title>
<style>
@font-face { font-family:'Geist'; font-weight:400; font-style:normal; font-display:swap;
  src:url(data:font/woff2;base64,${geistReg}) format('woff2'); }
@font-face { font-family:'Geist'; font-weight:600; font-style:normal; font-display:swap;
  src:url(data:font/woff2;base64,${geistSemi}) format('woff2'); }
@font-face { font-family:'Geist Mono'; font-weight:400; font-style:normal; font-display:swap;
  src:url(data:font/woff2;base64,${monoReg}) format('woff2'); }

:root{
  --ink:#0A0A09; --panel:#111110; --line:#242320; --bone:#E9E6DD; --mute:#8B877C;
  --amber:${AMBER}; --cobalt:${COBALT};
}
html{ background:var(--ink); }
body{ font-family:'Geist',system-ui,sans-serif; background:var(--ink); color:var(--bone);
  line-height:1.6; -webkit-font-smoothing:antialiased; }
.wrap{ max-width:1060px; margin:0 auto; padding:72px 32px 96px; }

header.top{ border-bottom:1px solid var(--line); padding-bottom:44px; margin-bottom:8px; }
.eyebrow{ font-family:'Geist Mono',monospace; font-size:12px; letter-spacing:.14em; color:var(--mute);
  text-transform:uppercase; display:block; margin-bottom:20px; }
h1{ font-size:clamp(30px,4.6vw,44px); font-weight:600; letter-spacing:-0.025em; line-height:1.12;
  margin:0 0 18px; text-wrap:balance; }
.lede{ max-width:62ch; color:var(--mute); font-size:16px; margin:0; }
.lede strong{ color:var(--bone); font-weight:400; }

section.dir{ border-bottom:1px solid var(--line); padding:56px 0; }
.dir-head{ display:flex; gap:24px; align-items:flex-start; margin-bottom:36px; }
.dir-letter{ font-family:'Geist Mono',monospace; font-size:13px; border:1px solid var(--line);
  padding:6px 11px; margin-top:4px; }
.dir-head h2{ font-size:24px; font-weight:600; letter-spacing:-0.02em; margin:0 0 10px; }
.dir-sub{ color:var(--mute); max-width:60ch; margin:0; }

.dir-grid{ display:grid; grid-template-columns:minmax(260px,5fr) 7fr; gap:40px; }
@media (max-width:820px){ .dir-grid{ grid-template-columns:1fr; } }

.spec{ margin-bottom:24px; }
.spec p{ margin:0; color:var(--mute); font-size:14px; }
.spec-label{ font-family:'Geist Mono',monospace; font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--bone); display:block; margin-bottom:8px; }
.files{ font-family:'Geist Mono',monospace; font-size:12px; line-height:1.9; }
.chips{ display:flex; flex-wrap:wrap; gap:8px; }
.chip{ font-family:'Geist Mono',monospace; font-size:12px; color:var(--mute);
  border:1px solid var(--line); padding:5px 10px 5px 6px; display:inline-flex; align-items:center; gap:8px; }
.chip i{ width:14px; height:14px; display:inline-block; border:1px solid var(--line); }
.chip-mute{ padding:5px 10px; }

.col-spec{ display:flex; flex-direction:column; gap:14px; }
.panel{ border:1px solid var(--line); background:var(--panel); }
.panel-hero{ display:flex; align-items:center; justify-content:center; padding:56px 0; }
.panel-hero svg{ transition:transform .18s ease; }
.panel-hero:hover svg{ transform:translateY(-2px) scale(1.015); }
.panel-lockup{ display:flex; align-items:center; gap:20px; padding:26px 30px; }
.wm{ font-weight:600; font-size:27px; letter-spacing:-0.015em; white-space:nowrap; }
.wm b{ font-weight:600; }
.wm-c{ font-weight:400; letter-spacing:.06em; }
.panel-ladder{ display:flex; align-items:center; justify-content:space-between; gap:24px;
  padding:22px 30px; flex-wrap:wrap; }
.rungs{ display:flex; align-items:flex-end; gap:26px; }
.rung{ display:flex; flex-direction:column; align-items:center; gap:10px; }
.rung-box{ display:flex; align-items:flex-end; }
.rung-cap{ font-family:'Geist Mono',monospace; font-size:11px; color:var(--mute); }

.tab-face{ display:flex; align-items:center; gap:9px; background:var(--ink); border:1px solid var(--line);
  border-bottom:none; padding:9px 14px; font-family:'Geist Mono',monospace; font-size:11px;
  color:var(--mute); border-radius:8px 8px 0 0; }
.tab-face i{ font-style:normal; margin-left:14px; color:#4b4841; }

footer.rec{ padding-top:52px; }
footer.rec h2{ font-size:20px; font-weight:600; letter-spacing:-0.02em; margin:0 0 14px; }
footer.rec p{ color:var(--mute); max-width:66ch; margin:0 0 14px; }
footer.rec strong{ color:var(--bone); font-weight:400; }
kbd{ font-family:'Geist Mono',monospace; font-size:12px; border:1px solid var(--line);
  padding:2px 7px; color:var(--bone); }

@media (prefers-reduced-motion:reduce){ .panel-hero svg{ transition:none; } .panel-hero:hover svg{ transform:none; } }
</style>

<div class="wrap">
  <header class="top">
    <span class="eyebrow">Quant AI · Brand · Phase 0 — Logo Directions</span>
    <h1>Three marks. One thesis: precision, not decoration.</h1>
    <p class="lede">Every direction is flat, single-idea geometry on near-black — built as clean SVG,
    already exported at every deliverable size. Ground is <strong>Ink #0A0A09</strong>, type is
    <strong>Geist</strong> throughout. Each section ends with the honest read: what the mark risks, not just what it promises.</p>
  </header>

  ${sections}

  <footer class="rec">
    <h2>Recommendation</h2>
    <p><strong>A — Signal Q</strong> is the pick if you want the name and the idea in one mark: it keeps the Q,
    owns an unusual accent (amber on ink reads terminal-grade, not crypto), and the breakout line gives the
    whole design system its one recurring gesture — the 45° signal line can echo through charts, empty states,
    and the loading skeleton.</p>
    <p><strong>B</strong> is the braver, more abstract identity; <strong>C</strong> is the quietest and most editorial.
    Amber from A can be paired with C's restraint if you want a hybrid (Block Q with an amber square).</p>
    <p>Reply with <kbd>A</kbd>, <kbd>B</kbd>, or <kbd>C</kbd> — or any adjustment (color, weight, tail angle,
    hybrid) and I'll revise before locking the exports and moving to Phase 1.</p>
  </footer>
</div>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log("written", OUT, (html.length / 1024).toFixed(0) + "KB");
