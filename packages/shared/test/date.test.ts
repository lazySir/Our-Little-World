import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidDate, daysBetween, daysTogether, anniversaryInfo } from '../src/date.ts';

test('validates exact calendar dates and rejects rolled-over dates', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-11-16', '0001-01-01']) {
    assert.equal(isValidDate(date), true, date);
  }
  for (const date of [
    '2025-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '0000-01-01',
    '2026-01-01T00:00:00Z',
    null,
  ]) {
    assert.equal(isValidDate(date), false, String(date));
  }
});

test('counts calendar days across leap years independent of time zone offsets', () => {
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2025-02-28', '2025-03-01'), 1);
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(daysBetween('2026-11-16', '2026-11-15'), -1);
  assert.throws(() => daysBetween('2025-02-29', '2026-11-16'), { name: 'TypeError' });
});

test('counts the start date as the first day together', () => {
  assert.equal(daysTogether('2026-11-16', '2026-11-16'), 1);
  assert.equal(daysTogether('2026-11-15', '2026-11-16'), 2);
  assert.equal(daysTogether('2026-11-17', '2026-11-16'), 0);
});

test('uses February 28 for leap-day anniversaries in common years', () => {
  assert.deepEqual(anniversaryInfo('2024-02-29', '2025-02-27'), {
    date: '2024-02-29',
    nextDate: '2025-02-28',
    daysUntil: 1,
    isToday: false,
    years: 1,
  });
  assert.deepEqual(anniversaryInfo('2024-02-29', '2025-02-28'), {
    date: '2024-02-29',
    nextDate: '2025-02-28',
    daysUntil: 0,
    isToday: true,
    years: 1,
  });
  assert.deepEqual(anniversaryInfo('2024-02-29', '2025-03-01'), {
    date: '2024-02-29',
    nextDate: '2026-02-28',
    daysUntil: 364,
    isToday: false,
    years: 2,
  });
});

test('keeps February 29 in leap years and moves past occurrences forward', () => {
  assert.equal(anniversaryInfo('2024-02-29', '2028-02-28').nextDate, '2028-02-29');
  assert.equal(anniversaryInfo('2024-02-29', '2028-02-28').daysUntil, 1);
  assert.equal(anniversaryInfo('2024-02-29', '2028-03-01').nextDate, '2029-02-28');
  assert.equal(anniversaryInfo('2020-12-31', '2026-11-16').daysUntil, 45);
});

test('does not schedule an anniversary before its original date', () => {
  assert.deepEqual(anniversaryInfo('2027-02-28', '2026-11-16'), {
    date: '2027-02-28',
    nextDate: '2027-02-28',
    daysUntil: 104,
    isToday: false,
    years: 0,
  });
});

test('preserves a one-time date and its signed day distance', () => {
  assert.deepEqual(anniversaryInfo('2024-02-29', '2025-02-28', { recurring: false }), {
    date: '2024-02-29',
    nextDate: '2024-02-29',
    daysUntil: -365,
    isToday: false,
    years: 0,
  });
  assert.throws(() => anniversaryInfo('2025-02-29', '2026-11-16'), { name: 'TypeError' });
});
