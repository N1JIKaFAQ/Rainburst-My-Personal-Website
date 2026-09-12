/** 极简 PNG 读写（RGB8、无过滤），供自检脚本共用。零依赖。 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
const CRC_TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const lenB = Buffer.alloc(4); lenB.writeUInt32BE(data.length);
  const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([lenB, t, data, crcB]);
}
export function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
export function readPNG(path) {
  const b = readFileSync(path); let o = 8, w = 0, h = 0, d = [];
  while (o < b.length) { const l = b.readUInt32BE(o), t = b.toString("ascii", o + 4, o + 8), x = b.subarray(o + 8, o + 8 + l); if (t === "IHDR") { w = x.readUInt32BE(0); h = x.readUInt32BE(4); } if (t === "IDAT") d.push(x); o += 12 + l; }
  const raw = inflateSync(Buffer.concat(d));
  return { w, h, px: (x, y) => { const i = y * (w * 3 + 1) + 1 + x * 3; return [raw[i], raw[i + 1], raw[i + 2]]; } };
}
