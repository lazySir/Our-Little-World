export interface AssetReference {
  id: string;
  url: string;
}

export function isAssetUrlExpiring(url: string, now = Date.now(), bufferMs = 30_000) {
  const expires = url.match(/[?&]expires=(\d+)(?:&|$)/)?.[1];
  return expires !== undefined && Number(expires) <= now + bufferMs;
}

/** Shares renewal requests for one asset and its current URL. */
export function createAssetRefresher<T extends AssetReference>(
  renew: (id: string) => Promise<Partial<T> & Pick<AssetReference, "id" | "url">>,
){
  const requests = new Map<string, Promise<Partial<T> & Pick<AssetReference, "id" | "url">>>();

  return async function refresh(asset?: T | null): Promise<T | undefined> {
    if (!asset?.id) return asset ?? undefined;

    const key = asset.id + ":" + asset.url;
    let request = requests.get(key);
    if (!request) {
      request = renew(asset.id);
      requests.set(key, request);
      request.then(() => {
        if (requests.get(key) === request) requests.delete(key);
      }).catch(() => {
        if (requests.get(key) === request) requests.delete(key);
      });
    }

    const fresh = await request;
    Object.assign(asset, fresh);
    return asset;
  };
}
