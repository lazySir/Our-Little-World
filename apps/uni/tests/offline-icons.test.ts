import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';

test('prepared Wot icons embed the installed font for offline WeChat and H5 rendering', () => {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const vendor = dirname(require.resolve('wot-design-uni/package.json'));
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-components.ts'], {
    cwd: root,
    stdio: 'pipe',
    windowsHide: true,
  });
  const { css } = compile(
    resolve(root, 'src/uni_modules/wot-design-uni/components/wd-icon/index.scss'),
    { silenceDeprecations: ['import', 'global-builtin'] },
  );
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.equal(faces.length, 1, 'one shared font declaration serves both platforms');
  const embedded = /url\(["']?data:font\/ttf;base64,([A-Za-z0-9+/=]+)/.exec(faces[0]);
  assert(embedded, 'the icon font must be bundled rather than fetched from a CDN');
  assert.deepEqual(
    Buffer.from(embedded[1], 'base64'),
    readFileSync(resolve(vendor, 'components/wd-icon/wd-icons.ttf')),
  );
  assert.doesNotMatch(css, /url\(["']?(?:https?:)?\/\//);
  assert.match(css, /\.wd-icon-view:before/);
  assert.match(css, /\.wd-icon-eye-close:before/);
});
