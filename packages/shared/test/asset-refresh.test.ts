import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssetRefresher, isAssetUrlExpiring } from '../src/asset-refresh.ts';

test('a signed photo URL is considered expiring only inside the preview safety window', () => {
  const now = 1_000_000;
  assert.equal(isAssetUrlExpiring(`/api/assets/1/file?expires=${now + 29_999}&signature=x`, now), true);
  assert.equal(isAssetUrlExpiring(`/api/assets/1/file?expires=${now + 30_001}&signature=x`, now), false);
  assert.equal(isAssetUrlExpiring('/api/assets/1/file?signature=x', now), false);
});

test('concurrent failures for one stale photo link share a renewal and update every reference', async () => {
  let calls = 0;
  let finish!: (asset: { id: string; url: string }) => void;
  const pending = new Promise<{ id: string; url: string }>((resolve) => (finish = resolve));
  const refresh = createAssetRefresher(async (id: string) => {
    calls++;
    assert.equal(id, 'photo-1');
    return pending;
  });
  const first = { id: 'photo-1', url: '/expired' };
  const second = { id: 'photo-1', url: '/expired' };

  const firstRefresh = refresh(first);
  const secondRefresh = refresh(second);
  assert.equal(calls, 1);
  finish({ id: 'photo-1', url: '/fresh' });
  await Promise.all([firstRefresh, secondRefresh]);

  assert.equal(first.url, '/fresh');
  assert.equal(second.url, '/fresh');
});

test('a transient renewal failure can be retried for the same stale URL', async () => {
  let calls = 0;
  const refresh = createAssetRefresher(async (id: string) => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { id, url: '/fresh' };
  });
  const first = { id: 'photo-1', url: '/expired' };

  await assert.rejects(refresh(first), /offline/);
  assert.equal((await refresh(first))?.url, '/fresh');

  assert.equal(calls, 2);
});
