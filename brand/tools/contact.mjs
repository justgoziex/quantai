import fs from "node:fs"; import path from "node:path"; import sharp from "sharp";
const P = "/Users/MAC/quantai/brand/png";
const names = ["a-signal","b-pulse","c-block"];
const rows = [];
for (const n of names) {
  const mark = await sharp(path.join(P,`${n}-mark-512.png`)).resize(280,280).toBuffer();
  const fav = await sharp(path.join(P,`${n}-favicon-64.png`)).toBuffer();
  const fav32 = await sharp(path.join(P,`${n}-favicon-32.png`)).toBuffer();
  const lock = await sharp(path.join(P,`${n}-lockup-1600.png`)).resize({width:700}).toBuffer();
  rows.push({mark,fav,fav32,lock});
}
const W=1200, RH=360, H=RH*3;
let comps=[];
rows.forEach((r,i)=>{
  const y=i*RH+40;
  comps.push({input:r.mark, left:40, top:i*RH+40});
  comps.push({input:r.lock, left:380, top:i*RH+120});
  comps.push({input:r.fav, left:380, top:y});
  comps.push({input:r.fav32, left:470, top:y+16});
});
await sharp({create:{width:W,height:H,channels:4,background:"#0A0A09"}}).composite(comps).png().toFile("/Users/MAC/quantai/brand/contact-sheet.png");
console.log("ok");
