import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareUniEcharts, uniEchartsAliases, uniEchartsPaths } from '../scripts/prepare-echarts';

const require = createRequire(import.meta.url);
const published = fileURLToPath(import.meta.resolve('uni-echarts'));
const packageRoot = resolve(dirname(published), '../../..');

test('component preparation copies the locked release, helpers and license and restores stale copies', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'world-echarts-components-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'uni-echarts');
  await prepareUniEcharts(target);
  const relative = 'src/components/uni-echarts/uni-echarts.vue';
  for (const file of [relative, 'src/shared-core.js', 'src/index.js', 'LICENSE', 'package.json']) {
    assert.deepEqual(await readFile(join(target, file)), await readFile(join(packageRoot, file)));
  }
  assert.equal(JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).version, '2.5.4');
  await writeFile(join(target, relative), 'stale generated component');
  await prepareUniEcharts(target);
  assert.deepEqual(await readFile(join(target, relative)), await readFile(published));
});

test('exact aliases keep the chart and injection helpers in the same generated package', () => {
  const aliases = uniEchartsAliases();
  const redirected = (id: string) => {
    const alias = aliases.find((candidate) => candidate.find.test(id));
    return alias ? id.replace(alias.find, alias.replacement) : id;
  };
  assert.equal(redirected('uni-echarts'), uniEchartsPaths.component);
  assert.equal(redirected('uni-echarts/shared'), uniEchartsPaths.shared);
  assert.equal(
    resolve(uniEchartsPaths.sharedCore),
    resolve(uniEchartsPaths.shared.replace('index.js', 'shared-core.js')),
  );
  for (const id of [
    'uni-echarts/vite',
    'uni-echarts/resolver',
    'other-uni-echarts',
    'uni-echarts?vue',
  ]) {
    assert.equal(redirected(id), id);
  }
  assert.equal(
    resolve(dirname(uniEchartsPaths.component), '../../shared-core.js'),
    resolve(dirname(uniEchartsPaths.shared), 'shared-core.js'),
  );
});

test('the actual uni filename normalizer produces an application-local component path', () => {
  const { normalizeMiniProgramFilename } = require('@dcloudio/uni-cli-shared');
  const input = fileURLToPath(new URL('../src', import.meta.url));
  assert.equal(normalizeMiniProgramFilename(published, input).startsWith('../'), true);
  assert.equal(
    normalizeMiniProgramFilename(uniEchartsPaths.component, input),
    'uni_modules/uni-echarts/src/components/uni-echarts/uni-echarts.vue',
  );
});
