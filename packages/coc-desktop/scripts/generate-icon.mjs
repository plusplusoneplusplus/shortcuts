// Generates the CoC desktop app icon (1024x1024 RGBA PNG) at media/coc-icon.png.
// Pure Node (zlib only) so it runs without any image tooling or the electron
// binary. electron-builder consumes this single PNG and derives the per-platform
// .icns / .ico at pack time (AC-07: "App icons sourced from media/").
//
// Run: node packages/coc-desktop/scripts/generate-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', '..', '..', 'media', 'coc-icon.png');

const S = 1024;
const cx = S / 2;
const cy = S / 2;
const half = S / 2 - 90; // rounded-square half extent (90px breathing room)
const corner = 200; // corner radius of the app tile
const outerR = 300; // outer radius of the "C" ring
const innerR = 195; // inner radius of the "C" ring
const openDeg = 40; // half-angle of the ring opening (gives the "C" its mouth)

const top = [79, 70, 229]; // indigo-600 (tile gradient top)
const bot = [124, 58, 237]; // violet-600 (tile gradient bottom)
const ink = [255, 255, 255]; // glyph color

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// Signed distance to a rounded rectangle centered at (cx,cy).
function sdRoundRect(px, py) {
  const qx = Math.abs(px - cx) - half + corner;
  const qy = Math.abs(py - cy) - half + corner;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  const outside = Math.sqrt(ax * ax + ay * ay);
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - corner;
}

const raw = Buffer.alloc(S * (S * 4 + 1)); // each row: 1 filter byte + S*RGBA
let o = 0;
const openRad = (openDeg * Math.PI) / 180;
for (let y = 0; y < S; y++) {
  raw[o++] = 0; // PNG filter type 0 (none)
  for (let x = 0; x < S; x++) {
    const t = y / (S - 1);
    let r = lerp(top[0], bot[0], t);
    let g = lerp(top[1], bot[1], t);
    let b = lerp(top[2], bot[2], t);

    // Rounded-square mask with 1px anti-aliased edge.
    const d = sdRoundRect(x + 0.5, y + 0.5);
    let a = Math.round(Math.max(0, Math.min(1, 0.5 - d)) * 255);

    // White "C" ring with an opening on the right.
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRing = dist <= outerR && dist >= innerR;
    const inOpening = Math.abs(Math.atan2(dy, dx)) < openRad;
    if (a > 0 && inRing && !inOpening) {
      r = ink[0];
      g = ink[1];
      b = ink[2];
    }

    raw[o++] = r;
    raw[o++] = g;
    raw[o++] = b;
    raw[o++] = a;
  }
}

// Minimal PNG encoder (8-bit RGBA, single IDAT).
const crcTable = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return tbl;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0);
  return Buffer.concat([len, typeBuf, body, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${S}x${S}, ${png.length} bytes)`);
