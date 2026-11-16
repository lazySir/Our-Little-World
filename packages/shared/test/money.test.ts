import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCents, formatCents } from '../src/money.ts';

test('parses decimal amounts without floating point rounding', () => {
  assert.equal(parseCents('0.10'), 10);
  assert.equal(parseCents('19.99'), 1999);
  assert.equal(parseCents('12'), 1200);
  assert.equal(parseCents(' 0012.3 '), 1230);
  assert.equal(parseCents(0.29), 29);
  assert.equal(parseCents('-1.05'), -105);
  assert.equal(parseCents('+1.05'), 105);
  assert.equal(parseCents('-0.00'), 0);
});

test('rejects invalid amounts and excess fractional precision', () => {
  for (const input of ['', ' ', '1.234', '1e3', '1,000.00', 'abc', '.50', '2.', NaN, Infinity, null, undefined, true]) {
    assert.throws(() => parseCents(input), { name: 'TypeError' }, String(input));
  }
});

test('rejects amounts outside safe integer cents', () => {
  assert.equal(parseCents('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(parseCents('-90071992547409.91'), Number.MIN_SAFE_INTEGER);
  assert.throws(() => parseCents('90071992547409.92'), { name: 'RangeError' });
});

test('formats safe integer cents as fixed two-decimal amounts', () => {
  assert.equal(formatCents(0), '0.00');
  assert.equal(formatCents(1), '0.01');
  assert.equal(formatCents(105), '1.05');
  assert.equal(formatCents(-105), '-1.05');
  assert.equal(formatCents(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  assert.equal(formatCents(Number.MIN_SAFE_INTEGER), '-90071992547409.91');
});

test('rejects fractional or unsafe cents for formatting', () => {
  for (const input of [1.5, NaN, Infinity, '100', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatCents(input), { name: 'TypeError' }, String(input));
  }
});

