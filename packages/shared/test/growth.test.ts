import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGrowthMeasurements, type GrowthMeasurement } from '../src/growth.ts';

test('returns empty series for no measurements', () => {
  assert.deepEqual(projectGrowthMeasurements([]), { height: [], weight: [] });
});

test('projects a single measurement without rounding either value', () => {
  assert.deepEqual(
    projectGrowthMeasurements([
      { id: 'single', date: '2026-11-20', heightCm: 63.123456789, weightKg: 6.123456789 },
    ]),
    {
      height: [{ id: 'single', date: '2026-11-20', value: 63.123456789 }],
      weight: [{ id: 'single', date: '2026-11-20', value: 6.123456789 }],
    },
  );
});

test('projects height and weight independently without filling missing values with zero', () => {
  assert.deepEqual(
    projectGrowthMeasurements([
      { id: 'weight-only', date: '2026-11-21', weightKg: 5.4 },
      { id: 'height-only', date: '2026-11-20', heightCm: 60.2 },
      { id: 'bad-height', date: '2026-11-22', heightCm: '61', weightKg: 5.5 },
      { id: 'bad-weight', date: '2026-11-23', heightCm: 61.2, weightKg: -1 },
      { id: 'neither', date: '2026-11-24' },
    ]),
    {
      height: [
        { id: 'height-only', date: '2026-11-20', value: 60.2 },
        { id: 'bad-weight', date: '2026-11-23', value: 61.2 },
      ],
      weight: [
        { id: 'weight-only', date: '2026-11-21', value: 5.4 },
        { id: 'bad-height', date: '2026-11-22', value: 5.5 },
      ],
    },
  );
});

test('accepts positive numeric values through the inclusive API limits', () => {
  assert.deepEqual(
    projectGrowthMeasurements([
      { id: 'minimum', date: '2026-11-20', heightCm: Number.MIN_VALUE, weightKg: Number.MIN_VALUE },
      { id: 'maximum', date: '2026-11-21', heightCm: 250, weightKg: 200 },
    ]),
    {
      height: [
        { id: 'minimum', date: '2026-11-20', value: Number.MIN_VALUE },
        { id: 'maximum', date: '2026-11-21', value: 250 },
      ],
      weight: [
        { id: 'minimum', date: '2026-11-20', value: Number.MIN_VALUE },
        { id: 'maximum', date: '2026-11-21', value: 200 },
      ],
    },
  );
});

test('rejects values above each limit without discarding the other valid field', () => {
  assert.deepEqual(
    projectGrowthMeasurements([
      { id: 'too-tall', date: '2026-11-20', heightCm: 250.00000000000003, weightKg: 200 },
      { id: 'too-heavy', date: '2026-11-21', heightCm: 250, weightKg: 200.00000000000003 },
    ]),
    {
      height: [{ id: 'too-heavy', date: '2026-11-21', value: 250 }],
      weight: [{ id: 'too-tall', date: '2026-11-20', value: 200 }],
    },
  );
});

test('rejects nonpositive, nonfinite, and nonnumber values without coercion', () => {
  for (const value of [
    0,
    -0,
    -1,
    NaN,
    Infinity,
    -Infinity,
    '60',
    '5.5',
    '',
    ' ',
    null,
    undefined,
    true,
    false,
    [],
    [60],
    {},
    new Number(60),
    60n,
    Symbol('60'),
  ]) {
    assert.deepEqual(
      projectGrowthMeasurements([
        { id: 'invalid', date: '2026-11-20', heightCm: value, weightKg: value },
      ]),
      { height: [], weight: [] },
      String(value),
    );
  }
});

test('keeps all valid calendar dates including leap days, early years, and future dates', () => {
  const dates = ['9999-12-31', '2024-02-29', '2000-02-29', '0001-01-01', '1999-12-31'];
  const expected = ['0001-01-01', '1999-12-31', '2000-02-29', '2024-02-29', '9999-12-31'].map(
    (date) => ({ id: date, date, value: 50 }),
  );
  assert.deepEqual(
    projectGrowthMeasurements(
      dates.map((date) => ({ id: date, date, heightCm: 50, weightKg: 50 })),
    ),
    { height: expected, weight: expected },
  );
});

test('rejects absent, malformed, and impossible calendar dates in both series', () => {
  const invalidDates: unknown[] = [
    undefined,
    null,
    '',
    ' ',
    '2025-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '2026-01-1',
    '0000-01-01',
    '10000-01-01',
    '2026-01-01T00:00:00Z',
    ' 2026-01-01',
    '2026-01-01 ',
    20261120,
  ];
  for (const date of invalidDates) {
    assert.deepEqual(
      projectGrowthMeasurements([
        { id: 'invalid-date', date: date as string, heightCm: 60, weightKg: 6 },
      ]),
      { height: [], weight: [] },
      String(date),
    );
  }
});

test('sorts dates ascending and retains every same-day measurement in each series', () => {
  const records = [
    { id: 'last', date: '2026-11-22', heightCm: 63, weightKg: 6.3 },
    {
      id: 'second',
      date: '2026-11-21',
      heightCm: 62,
      weightKg: 6.2,
      createdAt: '2026-11-21T02:00:00Z',
    },
    { id: 'first', date: '2026-11-20', heightCm: 60, weightKg: 6 },
    {
      id: 'same-day-first',
      date: '2026-11-21',
      heightCm: 61,
      weightKg: 6.1,
      createdAt: '2026-11-21T01:00:00Z',
    },
  ];
  const result = projectGrowthMeasurements(records);
  assert.deepEqual(
    result.height.map((point) => point.id),
    ['first', 'same-day-first', 'second', 'last'],
  );
  assert.deepEqual(
    result.weight.map((point) => point.id),
    ['first', 'same-day-first', 'second', 'last'],
  );
});

test('puts invalid or missing creation times before valid times on the same day', () => {
  const records: GrowthMeasurement[] = [
    { id: 'z-valid', createdAt: '2026-11-20T01:00:00Z' },
    { id: 'c-missing' },
    { id: 'a-empty', createdAt: '' },
    { id: 'b-invalid', createdAt: 'not-a-time' },
    { id: 'a-valid', createdAt: '2026-11-20T02:00:00Z' },
  ].map((record) => ({ ...record, date: '2026-11-20', heightCm: 60, weightKg: 6 }));
  const expected = ['a-empty', 'b-invalid', 'c-missing', 'z-valid', 'a-valid'];
  for (const input of [
    records,
    [...records].reverse(),
    [records[3], records[4], records[0], records[2], records[1]],
  ]) {
    const result = projectGrowthMeasurements(input);
    assert.deepEqual(
      result.height.map((point) => point.id),
      expected,
    );
    assert.deepEqual(
      result.weight.map((point) => point.id),
      expected,
    );
  }
});

test('uses parsed timestamps and stable id order for every same-day input permutation', () => {
  const records: GrowthMeasurement[] = [
    { id: 'm-invalid', createdAt: 'invalid' },
    { id: 'z-missing' },
    { id: 'b-later', createdAt: '2026-11-20T00:00:01Z' },
    { id: 'y-offset', createdAt: '2026-11-20T08:00:00+08:00' },
    { id: 'd-utc', createdAt: '2026-11-20T00:00:00Z' },
    { id: 'x-epoch', createdAt: '1970-01-01T00:00:00Z' },
  ].map((record) => ({ ...record, date: '2026-11-20', heightCm: 60, weightKg: 6 }));
  const expected = ['m-invalid', 'z-missing', 'x-epoch', 'd-utc', 'y-offset', 'b-later'];

  function checkPermutations(prefix: GrowthMeasurement[], remaining: GrowthMeasurement[]) {
    if (remaining.length === 0) {
      const result = projectGrowthMeasurements(prefix);
      assert.deepEqual(
        result.height.map((point) => point.id),
        expected,
      );
      assert.deepEqual(
        result.weight.map((point) => point.id),
        expected,
      );
      return;
    }
    for (let index = 0; index < remaining.length; index++) {
      checkPermutations(
        [...prefix, remaining[index]],
        remaining.filter((_, other) => other !== index),
      );
    }
  }

  checkPermutations([], records);
});

test('uses deterministic lexical id order for equal times including missing times', () => {
  const expected = ['Z', 'a', 'aa', 'b', 'é', '中'];
  for (const createdAt of [undefined, '2026-11-20T00:00:00Z']) {
    const records = [...expected].reverse().map((id) => ({
      id,
      date: '2026-11-20',
      heightCm: 60,
      weightKg: 6,
      createdAt,
    }));
    const result = projectGrowthMeasurements(records);
    assert.deepEqual(
      result.height.map((point) => point.id),
      expected,
    );
    assert.deepEqual(
      result.weight.map((point) => point.id),
      expected,
    );
  }
});

test('accepts structurally compatible records regardless of their extra type field', () => {
  const records = [
    { id: 'note', type: 'note', date: '2026-11-20', heightCm: 60, weightKg: 6, note: 'checkup' },
    { id: 'milestone', type: 'milestone', date: '2026-11-21', heightCm: 61, weightKg: 6.1 },
  ];
  assert.deepEqual(projectGrowthMeasurements(records), {
    height: [
      { id: 'note', date: '2026-11-20', value: 60 },
      { id: 'milestone', date: '2026-11-21', value: 61 },
    ],
    weight: [
      { id: 'note', date: '2026-11-20', value: 6 },
      { id: 'milestone', date: '2026-11-21', value: 6.1 },
    ],
  });
});

test('does not mutate readonly input records or reuse points between projections', () => {
  const records = Object.freeze([
    Object.freeze({ id: 'second', date: '2026-11-21', heightCm: 61, weightKg: 6.1, note: 'kept' }),
    Object.freeze({ id: 'first', date: '2026-11-20', heightCm: 60, weightKg: 6 }),
  ]);
  const before = structuredClone(records);
  const first = projectGrowthMeasurements(records);
  const second = projectGrowthMeasurements(records);

  assert.deepEqual(records, before);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first.height, second.height);
  assert.notStrictEqual(first.height[0], second.height[0]);
  assert.notStrictEqual(first.height[0], first.weight[0]);
  first.height[0].value = 1;
  assert.equal(second.height[0].value, 60);
  assert.equal(records[1].heightCm, 60);
});
