import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const settingsPage = readFileSync(resolve(import.meta.dirname, '../src/pages/SettingsPage.vue'), 'utf8');

test('theme choices expose their selected state to assistive technology', () => {
  assert.match(
    settingsPage,
    /<button[\s\S]*?v-for="t in themes"[\s\S]*?:aria-pressed="space\.theme === t\.key"/,
  );
});
