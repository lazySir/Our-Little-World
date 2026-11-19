import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick } from 'vue';
import * as domain from '../src/lib/domain';

type Node = {
  type: string;
  text?: string;
  props: Record<string, any>;
  children: Node[];
  parent?: Node;
  addEventListener: (event: string, listener: Function) => void;
};
const makeNode = (type: string, text = ''): Node => ({
  type,
  text,
  props: {},
  children: [],
  addEventListener() {},
});
const renderer = createRenderer<Node, Node>({
  createElement: (type) => makeNode(type),
  createText: (text) => makeNode('#text', text),
  createComment: (text) => makeNode('#comment', text),
  setText: (node, text) => {
    node.text = text;
  },
  setElementText: (node, text) => {
    node.text = text;
    node.children = [];
  },
  patchProp: (node, key, _old, value) => {
    node.props[key] = value;
  },
  parentNode: (node) => node.parent || null,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
    node.parent = parent;
  },
  remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = undefined;
  },
});
function all(node: Node): Node[] {
  return [node, ...node.children.flatMap(all)];
}
function textOf(node: Node): string {
  return node.type === '#comment' ? '' : (node.text || '') + node.children.map(textOf).join('');
}
const tick = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

// Run the actual page SFCs in Vue. Only platform UI, navigation and the network are replaced.
function mountPage(page: string) {
  const requests: { url: string; method: string; data?: any }[] = [];
  const shows: (() => Promise<void>)[] = [];
  let finishUpload: (value: any) => void = () => {};
  let failUpload: (error: Error) => void = () => {};
  const pendingUpload = new Promise((resolve, reject) => {
    finishUpload = resolve;
    failUpload = reject;
  });
  const api = {
    async request(url: string, method = 'GET', data?: any) {
      requests.push({ url, method, data });
      return method === 'GET' ? (url === '/baby' ? null : []) : { id: 'saved', ...data };
    },
    choosePhotos: async () => ['/camera/photo.png'],
    uploadFile: async () => pendingUpload,
    assetUrl: (asset: any) => asset.url,
    previewPhotos() {},
    notify() {},
    confirm: async () => true,
  };
  const session = { theme: 'cream', user: { id: 'owner', nickname: '我' }, load: async () => true };
  const require = createRequire(import.meta.url),
    cache = new Map<string, any>();
  function load(filename: string): any {
    if (cache.has(filename)) return cache.get(filename);
    const source = readFileSync(filename, 'utf8');
    const code = filename.endsWith('.vue')
      ? compileScript(
          parse(source, {
            filename: filename.replace(/\\/g, '/'),
            templateParseOptions: {
              isCustomElement: (tag) => ['picker', 'scroll-view'].includes(tag),
            },
          }).descriptor,
          {
            id: 'photos-test',
            inlineTemplate: true,
            templateOptions: {
              compilerOptions: {
                isCustomElement: (tag) => ['picker', 'scroll-view'].includes(tag),
              },
            },
          },
        ).content
      : source;
    const output = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const module = { exports: {} as any };
    const localRequire = (specifier: string) => {
      if (specifier === '@dcloudio/uni-app')
        return {
          onShow(callback: () => Promise<void>) {
            shows.push(callback);
          },
          onPullDownRefresh() {},
          onResize() {},
        };
      // Canvas rendering is a platform boundary; keep the real chart/page logic above it.
      if (specifier === 'uni-echarts') return { render: () => null };
      if (specifier === 'uni-echarts/shared') return { provideEcharts() {} };
      if (/lib\/api$/.test(specifier) || specifier === './api') return api;
      if (/stores\/session$/.test(specifier)) return { useSession: () => session };
      if (/lib\/domain$/.test(specifier)) return domain;
      if (specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), specifier);
        return load(path.extname(resolved) ? resolved : `${resolved}.ts`);
      }
      return require(specifier);
    };
    new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
  }
  (globalThis as any).uni = { hideTabBar() {}, showTabBar() {}, stopPullDownRefresh() {} };
  (globalThis as any).getCurrentPages = () => [{ route: `pages/${page}/index` }];
  const root = makeNode('root');
  const app = renderer.createApp(
    load(fileURLToPath(new URL(`../src/pages/${page}/index.vue`, import.meta.url))).default,
  );
  app.component(
    'wd-button',
    defineComponent({
      props: { disabled: Boolean, loading: Boolean },
      emits: ['click'],
      setup(props, { emit, slots }) {
        return () =>
          h(
            'button',
            {
              disabled: props.disabled || props.loading,
              onClick() {
                if (!props.disabled && !props.loading) emit('click');
              },
            },
            slots.default?.(),
          );
      },
    }),
  );
  app.component(
    'wd-popup',
    defineComponent({
      props: { modelValue: Boolean, closable: Boolean, closeOnClickModal: Boolean },
      emits: ['update:modelValue'],
      setup(props, { emit, slots }) {
        return () =>
          props.modelValue
            ? h('popup', {}, [
                h('overlay', {
                  onClick() {
                    if (props.closeOnClickModal) emit('update:modelValue', false);
                  },
                }),
                props.closable
                  ? h(
                      'button',
                      { class: 'popup-close', onClick: () => emit('update:modelValue', false) },
                      '关闭',
                    )
                  : null,
                slots.default?.(),
              ])
            : null;
      },
    }),
  );
  for (const tag of ['wd-input', 'wd-textarea'])
    app.component(
      tag,
      defineComponent({
        props: ['modelValue'],
        emits: ['update:modelValue'],
        setup(props, { emit }) {
          return () =>
            h('input', {
              value: props.modelValue,
              onInput: (value: string) => emit('update:modelValue', value),
            });
        },
      }),
    );
  app.component('wd-switch', defineComponent({ setup: () => () => h('switch') }));
  app.mount(root);
  const button = (label: string) => {
    const found = all(root).find((node) => node.type === 'button' && textOf(node).trim() === label);
    assert.ok(found, `Missing button: ${label}`);
    return found;
  };
  return {
    root,
    requests,
    button,
    finishUpload,
    failUpload,
    show: async () => {
      await Promise.all(shows.map((show) => show()));
      await tick();
    },
    unmount: () => app.unmount(),
  };
}

for (const scenario of [
  { page: 'memories', open: '＋ 写一篇', endpoint: '/memories' },
  { page: 'work', open: '＋ 写一篇', endpoint: '/work' },
  { page: 'menu', open: '＋ 添加', endpoint: '/menu' },
  { page: 'baby', open: '＋ 记录', endpoint: '/growth' },
  { page: 'baby', open: '建立宝宝档案', endpoint: '/baby' },
])
  test(`${scenario.endpoint} keeps its editor open and waits for pending photos before saving`, async () => {
    const view = mountPage(scenario.page);
    try {
      await view.show();
      view.button(scenario.open).props.onClick();
      await tick();
      const title = all(view.root)
        .find((node) => node.type === 'popup')
        ?.children.flatMap(all)
        .find((node) => node.type === 'input');
      assert.ok(title);
      title.props.onInput('有照片的记录');
      const picker = all(view.root).find((node) => node.props.class === 'upload-tile');
      assert.ok(picker);
      assert.ok(textOf(view.root).includes('重要原片请另行保存'));
      picker.props.onClick();
      await tick();
      view.button('保存这一刻').props.onClick();
      await tick();
      assert.equal(
        view.requests.filter((r) => r.method !== 'GET').length,
        0,
        'Saving while a photo is pending loses its attachment',
      );
      assert.equal(view.button('保存这一刻').props.disabled, true);
      view.button('先放一放').props.onClick();
      all(view.root)
        .find((node) => node.type === 'overlay')!
        .props.onClick();
      await tick();
      assert.ok(
        all(view.root).some((node) => node.type === 'popup'),
        'Uploading must prevent closing the editor',
      );
      assert.ok(
        !all(view.root).some((node) => node.props.class === 'popup-close'),
        'Uploading must hide the close control',
      );
      view.finishUpload({ id: 'photo-1', url: '/api/assets/photo-1/file' });
      await tick();
      assert.equal(view.button('保存这一刻').props.disabled, false);
      view.button('保存这一刻').props.onClick();
      await tick();
      const saved = view.requests.find((r) => r.url === scenario.endpoint && r.method !== 'GET');
      assert.ok(saved, 'The record should save once its upload has finished');
      if (scenario.endpoint === '/baby') assert.equal(saved.data.avatarId, 'photo-1');
      else if (scenario.endpoint === '/menu') assert.equal(saved.data.assetId, 'photo-1');
      else assert.deepEqual(saved.data.assetIds, ['photo-1']);
    } finally {
      view.finishUpload({ id: 'photo-1', url: '/api/assets/photo-1/file' });
      await tick();
      view.unmount();
    }
  });

test('a failed photo upload releases the editor controls and shows the upload error', async () => {
  const view = mountPage('memories');
  try {
    await view.show();
    view.button('＋ 写一篇').props.onClick();
    await tick();
    all(view.root)
      .find((node) => node.props.class === 'upload-tile')!
      .props.onClick();
    await tick();
    assert.equal(view.button('保存这一刻').props.disabled, true);
    view.failUpload(new Error('照片连接中断，请重试'));
    await tick();
    assert.ok(textOf(view.root).includes('照片连接中断，请重试'));
    assert.equal(view.button('保存这一刻').props.disabled, false);
    view.button('先放一放').props.onClick();
    await tick();
    assert.ok(!all(view.root).some((node) => node.type === 'popup'));
    assert.equal(view.requests.filter((r) => r.method !== 'GET').length, 0);
  } finally {
    view.finishUpload({ id: 'photo-1', url: '/api/assets/photo-1/file' });
    await tick();
    view.unmount();
  }
});
