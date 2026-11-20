import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function setup() {
  const storage = new Map<string, string>();
  const responses: ((response: Response) => void)[] = [];
  let businessDate = '';
  const localStorage = {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const fetch = () =>
    new Promise<Response>((resolve) => {
      responses.push(resolve);
    });
  const source = readFileSync(fileURLToPath(new URL('../src/api.ts', import.meta.url)), 'utf8');
  const output = ts.transpileModule(source.replaceAll('import.meta.env', '({})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'localStorage', 'window', 'navigator', 'fetch', output)(
    (specifier: string) => {
      if (specifier === './domain')
        return { setBusinessDate: (value: string) => (businessDate = value) };
      if (specifier === '@our-little-world/shared/asset-refresh')
        return { createAssetRefresher: () => async () => undefined };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
    module,
    module.exports,
    localStorage,
    new EventTarget(),
    { onLine: true },
    fetch,
  );
  return {
    api: module.exports,
    responses,
    date: () => businessDate,
    respond(index: number, date: string) {
      responses[index](
        Response.json({ date, month: date.slice(0, 7), events: [] }),
      );
    },
  };
}

test('older dashboard, calendar, and business-date responses cannot roll back a newer date', async () => {
  for (const [olderPath, newerPath] of [
    ['/dashboard', '/business-date'],
    ['/business-date', '/calendar?month=2026-11'],
    ['/calendar?month=2026-10', '/dashboard'],
  ]) {
    const s = setup();
    const older = s.api.request(olderPath);
    const newer = s.api.request(newerPath);
    assert.equal(s.responses.length, 2);

    s.respond(1, '2026-11-21');
    await newer;
    const newerDate = s.date();

    s.respond(0, '2026-11-19');
    await older;
    assert.equal(newerDate, '2026-11-21');
    assert.equal(s.date(), '2026-11-21', `${olderPath} must not override ${newerPath}`);
  }
});
