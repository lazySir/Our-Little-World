import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoney,
  nextAnniversary,
  today,
  setBusinessDate,
  splitTags,
  groupLedger,
} from '../src/domain.ts';
test('money preserves cents and rejects negative and fractional cents', () => {
  assert.equal(parseMoney('12.30'), 1230);
  assert.equal(parseMoney('0.01'), 1);
  assert.throws(() => parseMoney('1.005'));
  assert.throws(() => parseMoney('-2'));
});
test('leap day anniversary uses Feb 28 and rolls into next year', () => {
  assert.equal(
    nextAnniversary({ date: '2020-02-29', recurring: true }, '2025-02-27').date,
    '2025-02-28',
  );
  assert.equal(
    nextAnniversary({ date: '2020-02-29', recurring: true }, '2025-03-01').date,
    '2026-02-28',
  );
  assert.equal(nextAnniversary({ date: '2020-03-01', recurring: false }, '2025-03-01').days, -1826);
});
test('a recurring anniversary never starts before its first date', () => {
  assert.equal(
    nextAnniversary({ date: '2028-02-29', recurring: true }, '2026-11-17').date,
    '2028-02-29',
  );
  assert.equal(
    nextAnniversary({ date: '0099-01-01', recurring: true }, '0098-12-30').date,
    '0099-01-01',
  );
});
test('tags deduplicate and ledger excludes another month', () => {
  assert.deepEqual(splitTags('旅行， 家人,旅行'), ['旅行', '家人']);
  const stats = groupLedger(
    [
      { date: '2026-11-01', type: 'expense', amountCents: 150, category: '餐饮' },
      { date: '2026-11-02', type: 'income', amountCents: 300, category: '工资' },
      { date: '2026-10-01', type: 'expense', amountCents: 900, category: '餐饮' },
    ],
    '2026-11',
  );
  assert.equal(stats.balance, 150);
  assert.deepEqual(stats.categories, [{ name: '餐饮', value: 150 }]);
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('server business date overrides a device-local date for forms and month defaults', () => {
  setBusinessDate('2026-11-21');
  assert.equal(today(), '2026-11-21');
  setBusinessDate('');
});
