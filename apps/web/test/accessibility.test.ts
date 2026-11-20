import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (relativePath: string) =>
  readFileSync(resolve(import.meta.dirname, '../src', relativePath), 'utf8');
const style = source('style.css');

test('resource filters expose a named selected state', () => {
  const page = source('pages/ResourcePage.vue');
  assert.match(page, /class="filter-tabs"[\s\S]*?aria-label="记录筛选"/);
  assert.match(page, /:aria-pressed="tab === item.key"/);
});

test('meal and ledger filters expose a named selected state', () => {
  const meals = source('pages/MealsPage.vue');
  const ledger = source('pages/LedgerPage.vue');
  assert.match(meals, /class="filter-tabs"[\s\S]*?aria-label="菜单筛选"/);
  assert.match(meals, /:aria-pressed="tab === key"/);
  assert.match(ledger, /class="filter-tabs"[\s\S]*?aria-label="账本类型筛选"/);
  assert.match(ledger, /:aria-pressed="type === key"/);
});

test('desktop navigation and offline status preserve reachable content', () => {
  assert.match(style, /\.sidebar\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(style, /\.offline-banner\s*\{[\s\S]*?position:\s*static;/);
});

test('photo picker remains keyboard focusable while visually compact', () => {
  assert.match(style, /\.upload-add input\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(style, /\.upload-add:focus-within\s*\{[\s\S]*?outline:/);
});
