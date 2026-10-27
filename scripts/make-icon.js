'use strict';
// Draws the app icon (a clock on a green rounded square) and writes build/icon.png and public/icon.png.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 1024, SS = 3;
const bg = [31, 111, 92], fg = [255, 255, 255], acc = [217, 162, 27];
function sdRoundRect(x, y, cx, cy, hw, r) { const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hw + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; }
function sdSeg(x, y, ax, ay, bx, by) { const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay, h = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))); return Math.hypot(px - dx * h, py - dy * h); }
const C = N / 2;
function shade(x, y) {
  if (sdRoundRect(x, y, C, C, 412, 92) > 0) return null;
  const d = Math.hypot(x - C, y - C);
  if (Math.abs(d - 270) < 34) return fg;                       // clock ring
  if (sdSeg(x, y, C, C, C, C - 190) < 26) return fg;           // minute hand
  if (sdSeg(x, y, C, C, C + 130, C + 75) < 26) return fg;      // hour hand
  if (d < 40) return acc;                                      // centre
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; if (i % 3 === 0 && sdSeg(x, y, C + Math.sin(a) * 205, C - Math.cos(a) * 205, C + Math.sin(a) * 225, C - Math.cos(a) * 225) < 12) return fg; }
  return bg;
}
const px = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  px[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = shade(x + (sx + .5) / SS, y + (sy + .5) / SS);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = 255 * a / (SS * SS); }
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
function chunk(type, data) { const l = Buffer.alloc(4), t = Buffer.from(type), c = Buffer.alloc(4); l.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);
fs.writeFileSync(path.join(root, 'public', 'icon.png'), png);
console.log('Wrote build/icon.png and public/icon.png');
