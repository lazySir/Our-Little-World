import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createTestCleanup, stopChild, trackChild } from '../process-cleanup.mts';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  signals: NodeJS.Signals[] = [];
  killResult = true;
  onKill?: () => void;
  readonly pid: number | undefined;
  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }
  get child() {
    return this as unknown as ChildProcess;
  }
  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killed = true;
    this.signals.push(signal);
    this.onKill?.();
    return this.killResult;
  }
  exit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
  close() {
    this.emit('close', this.exitCode, this.signalCode);
  }
  finish(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.exit(code, signal);
    this.close();
  }
}

function observe(promise: Promise<void>) {
  const result: { status: 'pending' | 'fulfilled' | 'rejected'; error?: unknown } = {
    status: 'pending',
  };
  void promise.then(
    () => {
      result.status = 'fulfilled';
    },
    (error: unknown) => {
      result.status = 'rejected';
      result.error = error;
    },
  );
  return result;
}
async function flush() {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}
function windows(killer: FakeChild) {
  return { platform: 'win32' as const, spawnKiller: () => killer.child };
}

test('waits for both the target and its tree killer to close', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(101);
  const killer = new FakeChild(201);
  const result = observe(stopChild(target.child, windows(killer)));
  target.finish();
  await flush();
  assert.equal(result.status, 'pending', 'a live tree killer must prevent storage cleanup');
  killer.finish();
  await flush();
  assert.equal(result.status, 'fulfilled');
});

test('bounds a stalled Windows tree killer with one fallback inside ten seconds', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(102);
  const killer = new FakeChild(202);
  target.onKill = () => target.finish(null, 'SIGKILL');
  killer.onKill = () => killer.finish(null, 'SIGKILL');
  const result = observe(stopChild(target.child, windows(killer)));
  context.mock.timers.tick(4999);
  assert.deepEqual(target.signals, []);
  context.mock.timers.tick(1);
  await flush();
  assert.deepEqual(target.signals, ['SIGKILL']);
  assert.deepEqual(killer.signals, ['SIGKILL']);
  assert.equal(result.status, 'fulfilled');
  killer.exit(1);
  assert.deepEqual(target.signals, ['SIGKILL'], 'late killer events cannot repeat fallback');
});

test('does not trust a successful tree-killer code while its target is still live', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(103);
  const killer = new FakeChild(203);
  target.onKill = () => target.finish(null, 'SIGKILL');
  const result = observe(stopChild(target.child, windows(killer)));
  killer.finish();
  await flush();
  assert.equal(result.status, 'pending');
  context.mock.timers.tick(5000);
  await flush();
  assert.deepEqual(target.signals, ['SIGKILL']);
  assert.equal(result.status, 'fulfilled');
});

test('uses one immediate fallback when the tree killer fails', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(104);
  const killer = new FakeChild(204);
  target.onKill = () => target.finish(null, 'SIGKILL');
  const result = observe(stopChild(target.child, windows(killer)));
  killer.exit(1);
  killer.close();
  await flush();
  assert.deepEqual(target.signals, ['SIGKILL']);
  assert.equal(result.status, 'fulfilled');
  context.mock.timers.tick(10000);
  assert.deepEqual(target.signals, ['SIGKILL']);
});

test('handles a failed tree-killer spawn without treating the error as close', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(111);
  const killer = new FakeChild(undefined);
  target.onKill = () => target.finish(null, 'SIGKILL');
  const result = observe(stopChild(target.child, windows(killer)));
  killer.emit('error', new Error('spawn taskkill ENOENT'));
  await flush();
  assert.deepEqual(target.signals, ['SIGKILL']);
  assert.equal(result.status, 'pending');
  killer.close();
  await flush();
  assert.equal(result.status, 'fulfilled');
  assert.deepEqual(killer.signals, []);
});

test('remembers an early failed launch without signalling an undefined PID', async () => {
  const target = new FakeChild(undefined);
  trackChild(target.child);
  target.emit('error', new Error('spawn node ENOENT'));
  target.close();
  await stopChild(target.child, {
    platform: 'win32',
    spawnKiller: () => {
      throw new Error('no process was spawned');
    },
    killGroup: () => {
      throw new Error('no process group was spawned');
    },
  });
  assert.deepEqual(target.signals, []);
});

test('reports exit separately from close and safely retries after a late close', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(105);
  const killer = new FakeChild(205);
  const result = observe(stopChild(target.child, windows(killer)));
  target.exit(0);
  killer.finish();
  context.mock.timers.tick(10000);
  await flush();
  assert.equal(result.status, 'rejected');
  const message = String(result.error);
  assert.match(message, /target=.*"exit":true.*"close":false/);
  assert.match(message, /killer=.*"close":true/);
  assert.deepEqual(target.signals, [], 'an exited PID must not be signalled again');
  target.close();
  await stopChild(target.child, {
    ...windows(killer),
    spawnKiller: () => {
      throw new Error('an already closed target must not be relaunched');
    },
  });
});

test('a failed direct kill stays bounded and supplies target and killer diagnostics', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(106);
  const killer = new FakeChild(206);
  target.killResult = false;
  killer.killResult = false;
  const result = observe(stopChild(target.child, windows(killer)));
  context.mock.timers.tick(10000);
  await flush();
  assert.equal(result.status, 'rejected');
  assert.deepEqual(target.signals, ['SIGKILL']);
  assert.deepEqual(killer.signals, ['SIGKILL']);
  assert.match(String(result.error), /target=.*"pid":106/);
  assert.match(String(result.error), /killer=.*"pid":206/);
  assert.match(String(result.error), /fallback=.*"result":false/);
});

test('a retry still waits for the prior live tree killer after the target closes', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(107);
  const killer = new FakeChild(207);
  let launches = 0;
  const dependencies = {
    ...windows(killer),
    spawnKiller: () => {
      launches++;
      return killer.child;
    },
  };
  const first = observe(stopChild(target.child, dependencies));
  context.mock.timers.tick(10000);
  await flush();
  assert.equal(first.status, 'rejected');
  target.finish();
  const retry = observe(stopChild(target.child, dependencies));
  await flush();
  assert.equal(retry.status, 'pending', 'the first killer is still alive');
  assert.equal(launches, 1, 'do not target an exited PID with a second taskkill');
  killer.finish();
  await flush();
  assert.equal(retry.status, 'fulfilled');
});

test('coalesces cleanup and retries a failed stop without removing live storage', async () => {
  const child = new FakeChild(108);
  let attempts = 0;
  let removals = 0;
  const cleanup = createTestCleanup(
    [child.child],
    async () => {
      removals++;
    },
    async () => {
      attempts++;
      if (attempts === 1) throw new Error('still live');
    },
  );
  const first = cleanup();
  assert.equal(cleanup(), first);
  await assert.rejects(first, /still live/);
  assert.equal(removals, 0);
  await cleanup();
  assert.equal(attempts, 2);
  assert.equal(removals, 1);
  await cleanup();
  assert.equal(removals, 1);
});

test('waits for all owned children before rejecting and keeps storage intact', async () => {
  const first = new FakeChild(109);
  const second = new FakeChild(110);
  let finishSecond!: () => void;
  let removals = 0;
  const cleanup = createTestCleanup(
    [first.child, second.child],
    async () => {
      removals++;
    },
    async (child) => {
      if (child === first.child) throw new Error('first still live');
      await new Promise<void>((resolve) => {
        finishSecond = resolve;
      });
    },
  );
  const result = observe(cleanup());
  await flush();
  assert.equal(result.status, 'pending');
  assert.equal(removals, 0);
  finishSecond();
  await flush();
  assert.equal(result.status, 'rejected');
  assert.equal(removals, 0);
});

test('retries directory removal after stopping children and stays idempotent after success', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new FakeChild(112);
  const killer = new FakeChild(212);
  let launches = 0;
  let removals = 0;
  const cleanup = createTestCleanup(
    [target.child],
    async () => {
      removals++;
      if (removals === 1) throw new Error('directory busy');
    },
    (child) =>
      stopChild(child, {
        ...windows(killer),
        spawnKiller: () => {
          launches++;
          return killer.child;
        },
      }),
  );
  const first = cleanup();
  target.finish();
  killer.finish();
  await assert.rejects(first, /directory busy/);
  await cleanup();
  await cleanup();
  assert.equal(launches, 1, 'closed processes must not be signalled again when rm is retried');
  assert.equal(removals, 2);
});
