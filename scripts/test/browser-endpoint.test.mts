import assert from 'node:assert/strict';
import test from 'node:test';
import { webTestEndpoint } from '../../e2e/web-endpoint.mts';

test('browser verification uses the default or explicitly selected local port', () => {
  assert.deepEqual(webTestEndpoint(''), { origin: 'http://127.0.0.1:5174', port: 5174 });
  assert.deepEqual(webTestEndpoint('http://127.0.0.1:5184/'), {
    origin: 'http://127.0.0.1:5184',
    port: 5184,
  });
});

test('browser verification rejects remote origins, paths and the occupied API endpoint', () => {
  for (const value of [
    'https://127.0.0.1:5184',
    'http://example.com:5184',
    'http://127.0.0.1:5184/app',
    'http://127.0.0.1:5184/?token=test',
    'http://127.0.0.1:5184/#auth',
    'http://user:password@127.0.0.1:5184',
    'http://127.0.0.1:0',
    'http://127.0.0.1:3001',
  ])
    assert.throws(() => webTestEndpoint(value), /WEB_E2E_BASE/);
});
