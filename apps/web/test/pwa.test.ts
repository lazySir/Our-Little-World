import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('web install metadata includes raster icons for PWA and iOS', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-touch-icon[^>]+href="\/apple-touch-icon\.png"/);
  assert.match(viteConfig, /icon-192\.png/);
  assert.match(viteConfig, /icon-512\.png/);
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ] as const) {
    const path = resolve(root, 'public', name);
    assert.equal(existsSync(path), true, `${name} should exist`);
    assert.ok(statSync(path).size > 100, `${name} should contain image bytes`);
    const png = readFileSync(path);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), size, `${name} width`);
    assert.equal(png.readUInt32BE(20), size, `${name} height`);
  }
});
