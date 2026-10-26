import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { crc32, crc32File, contentKey } from '../src/services/crc32.js';

test('crc32 of the check string', () => assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926));

test('crc32 chains across chunks', () =>
  assert.equal(crc32(Buffer.from('6789'), crc32(Buffer.from('12345'))), 0xcbf43926));

test('crc32File matches crc32 of the bytes', async () => {
  // 200 KB of pseudo-random bytes, so the file spans several stream chunks
  const bytes = crypto.randomBytes(200 * 1024);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crc32-test-'));
  const tmp = path.join(dir, 'data.bin');
  try {
    fs.writeFileSync(tmp, bytes);
    assert.equal(await crc32File(tmp), crc32(bytes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('contentKey pads to 8 hex digits', () => assert.equal(contentKey(0xab, 12), '000000ab:12'));
