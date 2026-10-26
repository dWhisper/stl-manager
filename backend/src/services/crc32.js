import fs from 'fs';

// Standard reflected CRC-32 (polynomial 0xEDB88320), table built once at load
const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

// Pass the previous result as `prev` to chain across chunks
export function crc32(buf, prev = 0) {
  let c = ~prev >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// Streams the file so multi-GB models never sit in memory
export async function crc32File(filePath) {
  let crc = 0;
  const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
  for await (const chunk of stream) crc = crc32(chunk, crc);
  return crc;
}

// CRC plus size makes an accidental collision between different files very unlikely
export function contentKey(crc, size) {
  return `${(crc >>> 0).toString(16).padStart(8, '0')}:${size}`;
}
