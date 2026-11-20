import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { configureTrustedProxies, createRateLimitMiddleware } from '../src/rate-limit';
const closeLimiters: Array<() => void> = [];
after(() => closeLimiters.forEach((close) => close()));

function createTestApi(trustedProxies = '') {
  const app = express();
  configureTrustedProxies(app, trustedProxies);
  const limiter = createRateLimitMiddleware();
  closeLimiters.push(limiter.close);
  app.use(limiter);
  app.post('/api/auth/login', (_req, res) => res.status(401).json({ message: 'invalid login' }));
  return request(app);
}

test('untrusted forwarded addresses cannot bypass authentication throttling', async () => {
  const api = createTestApi();
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await api
      .post('/api/auth/login')
      .set('X-Forwarded-For', `198.51.100.${attempt + 1}`);
    assert.equal(response.status, 401, JSON.stringify(response.body));
  }
  const blocked = await api.post('/api/auth/login').set('X-Forwarded-For', '198.51.100.250');
  assert.equal(blocked.status, 429);
});

test('trusted proxy clients receive independent authentication buckets', async () => {
  const api = createTestApi('127.0.0.1');
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await api
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.10');
    assert.equal(response.status, 401, JSON.stringify(response.body));
  }
  assert.equal(
    (await api.post('/api/auth/login').set('X-Forwarded-For', '203.0.113.10')).status,
    429,
  );
  const otherClient = await api.post('/api/auth/login').set('X-Forwarded-For', '203.0.113.11');
  assert.equal(otherClient.status, 401, JSON.stringify(otherClient.body));
});
