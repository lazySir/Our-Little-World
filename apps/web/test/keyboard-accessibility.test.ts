import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const styleSheet = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf8');

test('skip-link destination keeps a visible focus indicator', () => {
  assert.match(
    styleSheet,
    /\.main-content:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\)/,
  );
});
