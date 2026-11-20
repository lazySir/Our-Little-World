import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBase,
  resolveAsset,
  centsFromInput,
  setBusinessDate,
  today,
  nextOccurrence,
  daysBetween,
  buildOrderItems,
  decodeResponse,
} from '../src/lib/domain.ts';

test('API base allows local LAN and HTTPS endpoints without duplicate api prefix', () => {
  assert.equal(normalizeBase(' http://192.168.1.8:3000/ '), 'http://192.168.1.8:3000/api');
  assert.equal(normalizeBase('https://home.example/api/'), 'https://home.example/api');
  assert.throws(() => normalizeBase('file:///secret'));
});

test('server business date overrides the device-local date used by forms', () => {
  setBusinessDate('2026-11-21');
  assert.equal(today(), '2026-11-21');
  setBusinessDate('');
});
test('signed asset URLs resolve on the API host without losing their signature', () => {
  assert.equal(
    resolveAsset('/api/assets/a/file?signature=abc', 'http://192.168.1.8:3000/api'),
    'http://192.168.1.8:3000/api/assets/a/file?signature=abc',
  );
});
test('money rejects negative values and excess decimals instead of rounding silently', () => {
  assert.equal(centsFromInput('12.30'), 1230);
  assert.throws(() => centsFromInput('-1'));
  assert.throws(() => centsFromInput('1.235'));
});
test('annual leap-day anniversaries use February 28 in a non leap year', () => {
  assert.equal(nextOccurrence('2024-02-29', true, '2027-02-01'), '2027-02-28');
  assert.equal(nextOccurrence('2024-02-29', true, '2027-03-01'), '2028-02-29');
});
test('an annual anniversary never occurs before its original future date', () => {
  assert.equal(nextOccurrence('2028-06-01', true, '2026-11-17'), '2028-06-01');
});

test('calendar day distances preserve the client target-first argument order', () => {
  assert.equal(daysBetween('2026-11-18', '2026-11-17'), 1);
  assert.equal(daysBetween('2026-11-16', '2026-11-17'), -1);
  assert.equal(daysBetween('2028-03-01', '2028-02-28'), 2);
});
test('order payload snapshots only selected menu entries and valid quantities', () => {
  assert.deepEqual(
    buildOrderItems(
      [
        { id: 'a', name: '面条' },
        { id: 'b', name: '茶' },
      ],
      { a: 2, b: 0 },
    ),
    [{ menuItemId: 'a', name: '面条', quantity: 2 }],
  );
  assert.throws(() => buildOrderItems([{ id: 'a', name: '面条' }], { a: 100 }));
});
test('API errors preserve server validation messages and malformed success rejects', () => {
  assert.throws(() => decodeResponse(400, { message: '金额必须大于 0' }), /金额必须大于 0/);
  assert.throws(() => decodeResponse(200, '<html>'), /服务地址/);
  assert.deepEqual(decodeResponse(200, { ok: true }), { ok: true });
});

for (const [status, message] of [
  [413, '数据超出网页备份或恢复范围，请停止服务后复制 data、storage 与 .env 进行离线备份或迁移'],
  [400, '备份文件无效或版本不匹配'],
  [415, '文件不是可读取的图片'],
] as const)
  test(`upload JSON text preserves the server guidance for HTTP ${status}`, () => {
    assert.throws(
      () => decodeResponse(status, JSON.stringify({ message })),
      (error: Error & { status?: number }) => {
        assert.equal(error.message, message);
        assert.equal(error.status, status);
        return true;
      },
    );
  });

test('a non-JSON HTTP error preserves its status without reporting an invalid success response', () => {
  assert.throws(
    () => decodeResponse(500, '<html>Server error</html>'),
    (error: Error & { status?: number }) => {
      assert.equal(error.message, '请求失败（500）');
      assert.equal(error.status, 500);
      return true;
    },
  );
});
