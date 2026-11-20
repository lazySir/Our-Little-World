import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBabyAlbumPhotos } from '../src/baby-album.ts';

test('baby album includes attached photos once, newest first, with their record context', () => {
  const records = [
    {
      id: 'older',
      title: '第一次抬头',
      date: '2025-03-01',
      assets: [{ id: 'shared-photo', url: '/photo' }, { id: 'older-photo', url: '/older' }],
    },
    {
      id: 'newer',
      title: '今天会笑了',
      date: '2025-03-04',
      assets: [{ id: 'shared-photo', url: '/photo' }, { id: 'new-photo', url: '/new' }],
    },
  ];

  assert.deepEqual(collectBabyAlbumPhotos(records), [
    { id: 'shared-photo', asset: { id: 'shared-photo', url: '/photo' }, title: '今天会笑了', date: '2025-03-04' },
    { id: 'new-photo', asset: { id: 'new-photo', url: '/new' }, title: '今天会笑了', date: '2025-03-04' },
    { id: 'older-photo', asset: { id: 'older-photo', url: '/older' }, title: '第一次抬头', date: '2025-03-01' },
  ]);
  assert.equal(records[0].assets[0].id, 'shared-photo', 'Collection must not mutate source records');
});

test('baby album is empty when records have no attached photos', () => {
  assert.deepEqual(collectBabyAlbumPhotos([{ id: 'record', title: '新记录', date: '2025-03-04' }]), []);
});
