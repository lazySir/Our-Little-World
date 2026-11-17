import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, ref } from 'vue';

type Node = {
  type: string;
  text?: string;
  props: Record<string, any>;
  children: Node[];
  parent?: Node;
};
const makeNode = (type: string, text = ''): Node => ({ type, text, props: {}, children: [] });
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
const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
const textOf = (node: Node): string =>
  node.type === '#comment' ? '' : (node.text || '') + node.children.map(textOf).join('');
const tick = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

function mountEditor({ standalone = false, disabled = false, uploading = false } = {}) {
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
            id: 'editor-test',
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
      if (!specifier.startsWith('.')) return require(specifier);
      const resolved = path.resolve(path.dirname(filename), specifier);
      return load(path.extname(resolved) ? resolved : `${resolved}.ts`);
    };
    new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
  }
  const EditorSheet = load(
    fileURLToPath(new URL('../src/components/EditorSheet.vue', import.meta.url)),
  ).default;
  const FormField = load(
    fileURLToPath(new URL('../src/components/FormField.vue', import.meta.url)),
  ).default;
  const initial = {
    title: '保存前',
    amount: '12',
    note: '原备注',
    date: '2026-11-17',
    category: 'expense',
    shared: false,
  };
  const values = reactive({ ...initial }),
    saving = ref(false),
    visible = ref(true),
    error = ref(''),
    explicitDisabled = ref(disabled);
  const snapshots: (typeof initial)[] = [];
  let rejectSave: (reason: Error) => void = () => {};
  const fields = () =>
    Object.entries({
      title: 'text',
      amount: 'number',
      note: 'textarea',
      date: 'date',
      category: 'select',
      shared: 'switch',
    }).map(([name, kind]) =>
      h('fieldcase', { name }, [
        h(FormField, {
          kind,
          label: name,
          modelValue: values[name as keyof typeof values],
          disabled: explicitDisabled.value,
          options: [
            { value: 'expense', label: '支出' },
            { value: 'income', label: '收入' },
          ],
          'onUpdate:modelValue': (value: any) => {
            (values as any)[name] = value;
          },
        }),
      ]),
    );
  const Host = defineComponent({
    setup() {
      return () =>
        standalone
          ? h('form', {}, fields())
          : h(
              EditorSheet,
              {
                modelValue: visible.value,
                saving: saving.value,
                uploading,
                error: error.value,
                'onUpdate:modelValue': (value: boolean) => {
                  visible.value = value;
                },
                async onSave() {
                  snapshots.push({ ...values });
                  saving.value = true;
                  try {
                    await new Promise((_resolve, reject) => {
                      rejectSave = reject;
                    });
                    visible.value = false;
                  } catch (cause: any) {
                    error.value = cause.message;
                  } finally {
                    saving.value = false;
                  }
                },
              },
              { default: fields },
            );
    },
  });
  (globalThis as any).uni = { hideTabBar() {}, showTabBar() {} };
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/ledger/index' }];
  const app = renderer.createApp(Host),
    root = makeNode('root');
  app.component(
    'wd-popup',
    defineComponent({
      props: { modelValue: Boolean },
      setup(props, { slots }) {
        return () => (props.modelValue ? h('popup', {}, slots.default?.()) : null);
      },
    }),
  );
  app.component(
    'wd-button',
    defineComponent({
      props: { disabled: Boolean, loading: Boolean },
      emits: ['click'],
      setup(props, { slots, emit }) {
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
  for (const [tag, element, event] of [
    ['wd-input', 'input', 'onInput'],
    ['wd-textarea', 'textarea', 'onInput'],
    ['wd-switch', 'switch', 'onChange'],
  ])
    app.component(
      tag,
      defineComponent({
        props: { modelValue: [String, Number, Boolean], disabled: Boolean },
        emits: ['update:modelValue'],
        setup(props, { emit }) {
          return () =>
            h(element, {
              value: props.modelValue,
              disabled: props.disabled,
              // Also deliver queued platform updates to verify the FormField boundary itself is guarded.
              [event]: (value: any) => emit('update:modelValue', value),
            });
        },
      }),
    );
  app.mount(root);
  function field(name: string) {
    const node = all(root).find(
      (candidate) => candidate.type === 'fieldcase' && candidate.props.name === name,
    );
    assert.ok(node, `Missing field: ${name}`);
    return all(node);
  }
  function control(name: string, type: string) {
    const node = field(name).find((candidate) => candidate.type === type);
    assert.ok(node, `Missing ${type} control for ${name}`);
    return node;
  }
  function clearDate() {
    field('date')
      .find((node) => textOf(node).trim() === '清除日期' && node.props.onClick)!
      .props.onClick();
  }
  function chooseCategory() {
    field('category')
      .find((node) => textOf(node).trim() === '收入' && node.props.onClick)!
      .props.onClick();
  }
  function assertLocked(expected: boolean) {
    for (const [name, type] of [
      ['title', 'input'],
      ['amount', 'input'],
      ['note', 'textarea'],
      ['date', 'picker'],
      ['shared', 'switch'],
    ])
      assert.equal(
        Boolean(control(name, type).props.disabled),
        expected,
        `${name} should ${expected ? 'lock' : 'unlock'}`,
      );
  }
  return {
    values,
    initial,
    root,
    snapshots,
    saving,
    visible,
    error,
    explicitDisabled,
    field,
    control,
    clearDate,
    chooseCategory,
    assertLocked,
    failSave: (message: string) => rejectSave(new Error(message)),
    save: () =>
      all(root)
        .find((node) => node.type === 'button' && textOf(node) === '保存这一刻')!
        .props.onClick(),
    unmount: () => app.unmount(),
  };
}

function attemptChanges(view: ReturnType<typeof mountEditor>) {
  view.control('title', 'input').props.onInput('保存中改名');
  view.control('amount', 'input').props.onInput('99');
  view.control('note', 'textarea').props.onInput('保存中补充');
  view.control('date', 'picker').props.onChange({ detail: { value: '2026-12-31' } });
  view.chooseCategory();
  view.control('shared', 'switch').props.onChange(true);
}

test('saving locks every form control and preserves its submitted draft until a failed save releases it', async () => {
  const view = mountEditor();
  try {
    view.save();
    await tick();
    assert.equal(view.saving.value, true);
    view.assertLocked(true);
    attemptChanges(view);
    assert.deepEqual({ ...view.values }, view.initial);
    view.clearDate();
    assert.equal(
      view.values.date,
      view.initial.date,
      'The clear-date action must also respect saving',
    );
    assert.deepEqual(view.snapshots, [view.initial]);
    view.failSave('网络中断，请重试');
    await tick();
    assert.equal(view.visible.value, true);
    assert.ok(textOf(view.root).includes('网络中断，请重试'));
    view.assertLocked(false);
    attemptChanges(view);
    await tick();
    assert.deepEqual(
      { ...view.values },
      {
        title: '保存中改名',
        amount: '99',
        note: '保存中补充',
        date: '2026-12-31',
        category: 'income',
        shared: true,
      },
    );
    view.clearDate();
    assert.equal(view.values.date, '');
  } finally {
    view.failSave('测试结束');
    await tick();
    view.unmount();
  }
});

test('uploading keeps text, numbers, dates and custom controls editable', async () => {
  const view = mountEditor({ uploading: true });
  try {
    view.assertLocked(false);
    attemptChanges(view);
    await tick();
    assert.deepEqual(
      { ...view.values },
      {
        title: '保存中改名',
        amount: '99',
        note: '保存中补充',
        date: '2026-12-31',
        category: 'income',
        shared: true,
      },
    );
    view.clearDate();
    assert.equal(view.values.date, '');
    view.save();
    assert.equal(view.snapshots.length, 0, 'Uploads continue to block submission');
  } finally {
    view.unmount();
  }
});

test('standalone fields stay editable by default and honor an explicit disabled flag', async () => {
  const view = mountEditor({ standalone: true, disabled: true });
  try {
    view.assertLocked(true);
    attemptChanges(view);
    view.clearDate();
    assert.deepEqual({ ...view.values }, view.initial);
    view.explicitDisabled.value = false;
    await tick();
    view.assertLocked(false);
    attemptChanges(view);
    await tick();
    assert.equal(view.values.title, '保存中改名');
    assert.equal(view.values.date, '2026-12-31');
    view.clearDate();
    assert.equal(view.values.date, '');
  } finally {
    view.unmount();
  }
});
