import test from 'node:test';
import assert from 'node:assert/strict';
import { toUniRequest } from '../src/lib/transport.ts';

test('PATCH reaches uni.request as POST with an override and the original body and authorization', () => {
  const payload = { title: '微信编辑' };
  const prepared = toUniRequest({
    url: 'https://home.example/api/wishes/one',
    method: 'PATCH',
    data: payload,
    header: { 'Content-Type': 'application/json', Authorization: 'Bearer private-token' },
    timeout: 20000,
  });
  assert.equal(prepared.method, 'POST');
  assert.equal(prepared.header['X-HTTP-Method-Override'], 'PATCH');
  assert.equal(prepared.header.Authorization, 'Bearer private-token');
  assert.equal(prepared.header['Content-Type'], 'application/json');
  assert.equal(prepared.data, payload);
  assert.equal(prepared.timeout, 20000);
  assert.equal(prepared.url, 'https://home.example/api/wishes/one');
});

test('ordinary uni request methods keep their method without adding an override', () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
    const prepared = toUniRequest({ url: 'https://home.example/api/wishes', method });
    assert.equal(prepared.method, method);
    assert.equal(prepared.header?.['X-HTTP-Method-Override'], undefined);
  }
});
