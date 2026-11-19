import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MagicString from 'magic-string';
import { normalizePath, type Plugin } from 'vite';

const targetVersion = '2.5.4';
const lines = (...value: string[]) => value.join('\n');
const instanceGuard = 'isUnmounted || chart.value !== instance || instance.isDisposed()';
const canvasSelector = String.fromCharCode(96) + '#${canvasId}' + String.fromCharCode(96);
// Match only the audited release: upstream drift must fail rather than silently
// rebuilding with an incomplete fix for a lifecycle race.
const patches = [
  {
    name: 'initialization lifetime',
    before: lines(
      'let deferInit = false;',
      '',
      'async function _init(option) {',
      '  if (!innerVisible.value) {',
    ),
    after: lines(
      'let isUnmounted = false;',
      'let deferInit = false;',
      '',
      'async function _init(option) {',
      '  if (isUnmounted) {',
      '    return;',
      '  }',
      '',
      '  if (!innerVisible.value) {',
    ),
  },
  {
    name: 'asynchronous canvas context',
    before: lines('  const context = await getContext();', '', '  canvasRect.top = context.top;'),
    after: lines(
      '  if (isUnmounted) {',
      '    return;',
      '  }',
      '',
      '  let context;',
      '  try {',
      '    context = await getContext();',
      '  } catch (error) {',
      '    if (isUnmounted) {',
      '      return;',
      '    }',
      '    throw error;',
      '  }',
      '',
      '  if (isUnmounted) {',
      '    return;',
      '  }',
      '',
      '  canvasRect.top = context.top;',
    ),
  },
  {
    name: 'option commit lifetime',
    before: lines('  const _commit = () => {', '    emit("inited");'),
    after: lines(
      '  const _commit = () => {',
      '    if (' + instanceGuard + ') {',
      '      return;',
      '    }',
      '',
      '    emit("inited");',
    ),
  },
  {
    name: 'inited listener reentrancy',
    before: lines('    if (isEmpty(opt)) {', '      return;', '    }'),
    after: lines('    if (' + instanceGuard + ' || isEmpty(opt)) {', '      return;', '    }'),
  },
  {
    name: 'autoresize nextTick lifetime',
    before: lines('    await nextTick();', '', '    _resize();'),
    after: lines(
      '    await nextTick();',
      '',
      '    if (' + instanceGuard + ') {',
      '      return;',
      '    }',
      '',
      '    _resize();',
    ),
  },
  {
    name: 'public initialization lifetime',
    before: lines('function init(option) {', '  if (initTask != null) {'),
    after: lines(
      'function init(option) {',
      '  if (isUnmounted) {',
      '    return Promise.resolve();',
      '  }',
      '',
      '  if (initTask != null) {',
    ),
  },
  {
    name: 'resize instance and asynchronous query',
    before: lines(
      'async function resize(options = {}) {',
      '  if (chart.value == null) {',
      '    return;',
      '  }',
      '',
      '  let { width, height } = options;',
      '',
      '  const updateWidth = isEmpty(width) || width === "auto";',
      '  const updateHeight = isEmpty(height) || height === "auto";',
      '',
      '  if (updateWidth || updateHeight) {',
      '    const el = await querySelect(vueThis, ' + canvasSelector + ', {',
      '      size: true',
      '    });',
      '',
      '    if (updateWidth) {',
      '      width = el.width;',
      '    }',
      '    if (updateHeight) {',
      '      height = el.height;',
      '    }',
      '  }',
      '',
      '  chart.value.resize({',
      '    ...options,',
      '    width,',
      '    height',
      '  });',
      '}',
    ),
    after: lines(
      'async function resize(options = {}) {',
      '  const instance = chart.value;',
      '  if (isUnmounted || instance == null || instance.isDisposed()) {',
      '    return;',
      '  }',
      '',
      '  let { width, height } = options;',
      '',
      '  const updateWidth = isEmpty(width) || width === "auto";',
      '  const updateHeight = isEmpty(height) || height === "auto";',
      '',
      '  if (updateWidth || updateHeight) {',
      '    let el;',
      '    try {',
      '      el = await querySelect(vueThis, ' + canvasSelector + ', {',
      '        size: true',
      '      });',
      '    } catch (error) {',
      '      if (isUnmounted) {',
      '        return;',
      '      }',
      '      throw error;',
      '    }',
      '',
      '    if (' + instanceGuard + ') {',
      '      return;',
      '    }',
      '',
      '    if (updateWidth) {',
      '      width = el.width;',
      '    }',
      '    if (updateHeight) {',
      '      height = el.height;',
      '    }',
      '  }',
      '',
      '  instance.resize({',
      '    ...options,',
      '    width,',
      '    height',
      '  });',
      '}',
    ),
  },
  {
    name: 'unmount invalidation before disposal',
    before: lines('onBeforeUnmount(() => {', '  cleanup();', '});'),
    after: lines('onBeforeUnmount(() => {', '  isUnmounted = true;', '  cleanup();', '});'),
  },
];

const sharedTouchPatches = [
  {
    name: 'touch query generation',
    before: 'let lastMoveEvent = null;',
    after: lines('let lastMoveEvent = null;', 'let touchGeneration = 0;'),
  },
  {
    name: 'touch start stale query handling',
    before: lines(
      '\tfunction onStart(event) {',
      '\t\ttouching.value = true;',
      '\t\tstate.t = Date.now();',
      '\t\tconst next = () => {',
      '\t\t\tif (chart.value == null) return;',
      '\t\t\tconst touch = getTouch(event, normalizeTouches(event.touches));',
      '\t\t\tstate.x = touch.x;',
      '\t\t\tstate.y = touch.y;',
      '\t\t\tconst { handler } = chart.value.getZr();',
      '\t\t\tUniCanvas.dispatch(handler, "mousedown", touch);',
      '\t\t\tUniCanvas.dispatch(handler, "mousemove", touch);',
      '\t\t\thandler.processGesture(transformTouchesEvent(event), "start");',
      '\t\t\tdestroyTimer();',
      '\t\t};',
      '\t\tquerySelect(vueThis, SELECTOR, { rect: true }).then(({ top, left }) => {',
      '\t\t\tcanvasRect.top = top;',
      '\t\t\tcanvasRect.left = left;',
      '\t\t}).finally(() => {',
      '\t\t\tnext();',
      '\t\t});',
      '\t}',
    ).replace('SELECTOR', canvasSelector),
    after: lines(
      '\tasync function onStart(event) {',
      '\t\tconst generation = ++touchGeneration;',
      '\t\tconst instance = chart.value;',
      '\t\ttouching.value = true;',
      '\t\tstate.t = Date.now();',
      '\t\tconst isCurrent = () => generation === touchGeneration && instance != null && chart.value === instance && !instance.isDisposed();',
      '\t\tconst next = () => {',
      '\t\t\tif (!isCurrent()) return;',
      '\t\t\tconst touch = getTouch(event, normalizeTouches(event.touches));',
      '\t\t\tstate.x = touch.x;',
      '\t\t\tstate.y = touch.y;',
      '\t\t\tconst { handler } = instance.getZr();',
      '\t\t\tUniCanvas.dispatch(handler, "mousedown", touch);',
      '\t\t\tUniCanvas.dispatch(handler, "mousemove", touch);',
      '\t\t\thandler.processGesture(transformTouchesEvent(event), "start");',
      '\t\t\tdestroyTimer();',
      '\t\t};',
      '\t\ttry {',
      '\t\t\tconst { top, left } = await querySelect(vueThis, SELECTOR, { rect: true });',
      '\t\t\tif (!isCurrent()) return;',
      '\t\t\tcanvasRect.top = top;',
      '\t\t\tcanvasRect.left = left;',
      '\t\t} catch (error) {',
      '\t\t\tif (!isCurrent()) return;',
      '\t\t\tthrow error;',
      '\t\t} finally {',
      '\t\t\tnext();',
      '\t\t}',
      '\t}',
    ).replace('SELECTOR', canvasSelector),
  },
  {
    name: 'touch end invalidation',
    before: lines('\tfunction onEnd(event) {', '\t\ttouching.value = false;'),
    after: lines(
      '\tfunction onEnd(event) {',
      '\t\t++touchGeneration;',
      '\t\ttouching.value = false;',
    ),
  },
  {
    name: 'touch cleanup invalidation',
    before: lines('\tfunction cleanup() {', '\t\tdestroyTimer();'),
    after: lines(
      '\tfunction cleanup() {',
      '\t\t++touchGeneration;',
      '\t\ttouching.value = false;',
      '\t\tdestroyTimer();',
    ),
  },
];

export function uniEchartsLifecycle(componentTarget?: string, sharedCoreTarget?: string): Plugin {
  // The package exports its SFC under the import condition, not require.
  const component = fileURLToPath(import.meta.resolve('uni-echarts'));
  const target = normalizePath(componentTarget || component);
  const sharedCore = normalizePath(
    sharedCoreTarget || fileURLToPath(new URL('../../shared-core.js', pathToFileURL(component))),
  );
  const manifest = JSON.parse(
    readFileSync(new URL('../../../package.json', pathToFileURL(component)), 'utf8'),
  ) as { version: string };
  if (manifest.version !== targetVersion) {
    throw new Error(
      'uni-echarts@' +
        targetVersion +
        ' lifecycle patch: found ' +
        manifest.version +
        '; revalidate the upstream lifecycle before upgrading.',
    );
  }

  return {
    name: 'uni-echarts-lifecycle',
    enforce: 'pre',
    // uni inserts its conditional preprocessor at index zero in configResolved.
    // Hook priority still runs this strict original-source patch before it.
    transform: {
      order: 'pre',
      handler(source, id) {
        // Vue subrequests contain already-processed script/template source.
        const normalizedId = normalizePath(id);
        const isComponent = normalizedId === target;
        const isSharedCore = normalizedId === sharedCore;
        if (!isComponent && !isSharedCore) return null;

        const targetPatches = isComponent ? patches : sharedTouchPatches;
        const edits = targetPatches.map((patch) => {
          const count = source.split(patch.before).length - 1;
          if (count !== 1) {
            throw new Error(
              'uni-echarts@' +
                targetVersion +
                ' lifecycle patch (' +
                patch.name +
                '): expected exactly one source anchor, found ' +
                count +
                '; revalidate the upstream lifecycle before upgrading.',
            );
          }
          return { ...patch, start: source.indexOf(patch.before) };
        });
        const result = new MagicString(source);
        for (const edit of edits) {
          result.overwrite(edit.start, edit.start + edit.before.length, edit.after);
        }
        return {
          code: result.toString(),
          map: result.generateMap({
            source: normalizedId,
            includeContent: true,
            hires: true,
          }),
        };
      },
    },
  };
}
