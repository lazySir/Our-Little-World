export interface BabyAlbumAsset {
  id: string;
}

export interface BabyAlbumRecord<TAsset extends BabyAlbumAsset = BabyAlbumAsset> {
  id: string;
  title?: string;
  date?: string;
  assets?: readonly TAsset[];
}

export interface BabyAlbumPhoto<TAsset extends BabyAlbumAsset = BabyAlbumAsset> {
  id: string;
  asset: TAsset;
  title: string;
  date: string;
}

/** Flatten growth-record attachments into a stable, newest-first baby photo album. */
export function collectBabyAlbumPhotos<TAsset extends BabyAlbumAsset>(
  records: readonly BabyAlbumRecord<TAsset>[],
): BabyAlbumPhoto<TAsset>[] {
  const byAsset = new Map<string, BabyAlbumPhoto<TAsset>>();
  const ordered = [...records].sort((left, right) => {
    const dateOrder = (right.date || '').localeCompare(left.date || '');
    return dateOrder || right.id.localeCompare(left.id);
  });

  for (const record of ordered) {
    for (const asset of record.assets || []) {
      if (!asset?.id || byAsset.has(asset.id)) continue;
      byAsset.set(asset.id, {
        id: asset.id,
        asset,
        title: record.title || '宝宝成长记录',
        date: record.date || '',
      });
    }
  }

  return [...byAsset.values()];
}
