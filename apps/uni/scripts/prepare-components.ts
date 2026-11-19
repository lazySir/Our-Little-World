import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUniEcharts } from './prepare-echarts';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = dirname(require.resolve('wot-design-uni/package.json'));
const target = resolve(root, 'src/uni_modules/wot-design-uni');
await mkdir(target, { recursive: true });
await cp(resolve(source, 'components'), resolve(target, 'components'), {
  recursive: true,
  force: true,
});
await cp(resolve(source, 'locale'), resolve(target, 'locale'), { recursive: true, force: true });
await cp(resolve(source, 'dayjs'), resolve(target, 'dayjs'), { recursive: true, force: true });
await cp(resolve(source, 'LICENSE'), resolve(target, 'LICENSE'), { force: true });
await cp(resolve(source, 'package.json'), resolve(target, 'package.json'), { force: true });
// WeChat cannot fall back to the local TTF URL used by Wot's H5 styles.
// Embed the font shipped in the installed package so neither target needs a CDN.
const iconStylesPath = resolve(target, 'components/wd-icon/index.scss');
const iconFont = await readFile(resolve(source, 'components/wd-icon/wd-icons.ttf'));
const iconStyles = await readFile(iconStylesPath, 'utf8');
let embedded = false;
const offlineStyles = iconStyles.replace(/@font-face\s*\{[^}]*\}/g, (face) => {
  if (!/font-family:\s*['"]wd-icons['"]/.test(face)) return face;
  if (embedded) return '';
  embedded = true;
  return face.replace(
    /src:[^;]+;/,
    `src: url('data:font/ttf;base64,${iconFont.toString('base64')}') format('truetype');`,
  );
});
if (!embedded) throw new Error('Wot 图标字体声明缺失，请检查组件库版本。');
await writeFile(iconStylesPath, offlineStyles);
console.log('Wot Design Uni 已从锁定的 npm 依赖同步到应用内组件目录。');
await prepareUniEcharts();
console.log('Uni ECharts 已从锁定的 npm 依赖同步到应用内组件目录。');
