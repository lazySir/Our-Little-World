import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as domain from '../src/lib/domain';
import * as transport from '../src/lib/transport';

const require = createRequire(import.meta.url);
function loadApi() {
  const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replace(
    'import.meta.env.VITE_API_BASE',
    "''",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls: { kind: string; options: any }[] = [];
  const uni = {
    showToast: (options: any) => calls.push({ kind: 'toast', options }),
    showModal: (options: any) => calls.push({ kind: 'modal', options }),
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'uni', output)(
    (name: string) =>
      name === './domain' ? domain : name === './transport' ? transport : require(name),
    module,
    module.exports,
    uni,
  );
  return { api: module.exports, calls };
}

test('notify keeps short messages as toasts', () => {
  const { api, calls } = loadApi();
  api.notify('保存失败');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'toast');
  assert.equal(calls[0].options.title, '保存失败');
});

test('notify keeps long success messages non-blocking', () => {
  const { api, calls } = loadApi();
  api.notify('今天的心情收好啦', 'success');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'toast');
  assert.equal(calls[0].options.title, '已完成');
});

test('notify presents the complete long message in a modal, not a toast', () => {
  const { api, calls } = loadApi();
  const message = '连接不到小世界，请检查服务是否启动和当前接口地址';
  api.notify(message);
  assert.deepEqual(calls, [
    {
      kind: 'modal',
      options: {
        title: '详细提示',
        content: message,
        showCancel: false,
        confirmText: '知道了',
      },
    },
  ]);
});
