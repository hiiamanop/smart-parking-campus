// Generator ikon PWA (PNG) tanpa dependency eksternal.
// Jalankan: node app/scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size;
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
    const cx = x < x0 + r ? x0 + r : x >= x1 - r ? x1 - r : x;
    const cy = y < y0 + r ? y0 + r : y >= y1 - r ? y1 - r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * s + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  const fill = (x0, y0, x1, y1, r, color) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(s, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(s, Math.ceil(x1)); x++) {
        if (inRound(x + 0.5, y + 0.5, x0, y0, x1, y1, r)) set(x, y, ...color);
      }
    }
  };

  // Background
  fill(0, 0, s, s, s * 0.19, [15, 118, 110, 255]);
  // Huruf P (stem + bowl)
  fill(s * 0.28, s * 0.26, s * 0.41, s * 0.74, s * 0.02, [255, 255, 255, 255]);
  fill(s * 0.38, s * 0.26, s * 0.70, s * 0.53, s * 0.10, [255, 255, 255, 255]);
  fill(s * 0.41, s * 0.34, s * 0.60, s * 0.45, s * 0.05, [15, 118, 110, 255]);
  // Aksen mint
  fill(s * 0.62, s * 0.62, s * 0.77, s * 0.77, s * 0.035, [153, 246, 228, 235]);

  return encodePng(s, s, buf);
}

for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, makeIcon(size));
  console.log('wrote', file);
}
