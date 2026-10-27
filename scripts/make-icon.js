'use strict';
// Draws the app icon and writes build/icon.png; public/icons/ holds the favicon sizes made from it.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 1024, SS = 3;
// Study Desk mark: an open book inside a 3/4 progress ring, white on a green gradient tile.
const g0 = [42, 138, 114], g1 = [20, 84, 70], W = [255, 255, 255];
const C = N / 2, R = 268, RW = 58;
function sdRoundRect(x, y, cx, cy, hw, r) { const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hw + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; }
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
const pageL = [[C - 150, C - 82], [C - 16, C - 58], [C - 16, C + 104], [C - 150, C + 80]];
const pageR = pageL.map(([x, y]) => [2 * C - x, y]);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function shade(x, y) {
  if (sdRoundRect(x, y, C, C, 412, 96) > 0) return null;
  let c = mix(g0, g1, Math.min(1, Math.max(0, ((x + y) / (2 * N)))));
  const d = Math.hypot(x - C, y - C);
  if (Math.abs(d - R) < RW / 2) {
    let th = Math.atan2(x - C, -(y - C)); if (th < 0) th += 2 * Math.PI;
    c = th <= 1.5 * Math.PI ? W : mix(c, W, 0.22);
  }
  if (Math.hypot(x - C, y - (C - R)) < RW / 2 || Math.hypot(x - (C - R), y - C) < RW / 2) c = W;
  if (inPoly(x, y, pageL) || inPoly(x, y, pageR)) c = W;
  return c;
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
console.log('Wrote build/icon.png');
