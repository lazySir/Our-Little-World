import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath } from 'vite';

const installedComponent = fileURLToPath(import.meta.resolve('uni-echarts'));
const packageRoot = resolve(dirname(installedComponent), '../../..');
const root = normalizePath(
  fileURLToPath(new URL('../src/uni_modules/uni-echarts', import.meta.url)),
);
export const uniEchartsPaths = {
  root,
  component: root + '/src/components/uni-echarts/uni-echarts.vue',
  shared: root + '/src/index.js',
  sharedCore: root + '/src/shared-core.js',
};

export function uniEchartsAliases(): { find: RegExp; replacement: string }[] {
  return [
    { find: /^uni-echarts$/, replacement: uniEchartsPaths.component },
    { find: new RegExp('^uni-echarts/shared$'), replacement: uniEchartsPaths.shared },
  ];
}

// uni's mini-program compiler needs component entries below the application root.
// Copy the locked npm source like Wot, preserving one shared injection-key module.
export async function prepareUniEcharts(target = root): Promise<void> {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  if (manifest.version !== '2.5.4') {
    throw new Error('uni-echarts component preparation requires audited release 2.5.4.');
  }
  await mkdir(target, { recursive: true });
  await cp(resolve(packageRoot, 'src'), resolve(target, 'src'), { recursive: true, force: true });
  await cp(resolve(packageRoot, 'LICENSE'), resolve(target, 'LICENSE'), { force: true });
  await cp(resolve(packageRoot, 'package.json'), resolve(target, 'package.json'), { force: true });
}
