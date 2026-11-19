import { spawn, type ChildProcess } from 'node:child_process';

interface StopDependencies {
  platform: NodeJS.Platform;
  spawnKiller: (pid: number) => ChildProcess;
  killGroup: (pid: number) => void;
}

const defaults: StopDependencies = {
  platform: process.platform,
  spawnKiller: (pid) =>
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }),
  killGroup: (pid) => {
    process.kill(-pid, 'SIGKILL');
  },
};

interface ChildState {
  exit: boolean;
  close: boolean;
  error?: string;
  killers: ChildProcess[];
}
const states = new WeakMap<ChildProcess, ChildState>();
const message = (error: unknown) => String(error).slice(0, 160);
const hasExited = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null || stateOf(child).exit;

function stateOf(child: ChildProcess): ChildState {
  const known = states.get(child);
  if (known) return known;
  const state: ChildState = {
    exit: child.exitCode !== null || child.signalCode !== null,
    close: false,
    killers: [],
  };
  states.set(child, state);
  child.once('exit', () => {
    state.exit = true;
  });
  child.once('close', () => {
    state.close = true;
  });
  child.once('error', (error) => {
    state.error = message(error);
  });
  return state;
}

/** Register at launch so an early or late close remains known across teardown retries. */
export function trackChild(child: ChildProcess) {
  stateOf(child);
  return child;
}

export async function stopChild(child: ChildProcess, input: Partial<StopDependencies> = {}) {
  const dependencies = { ...defaults, ...input };
  const state = stateOf(child);
  const complete = () => state.close && state.killers.every((killer) => stateOf(killer).close);
  if (complete()) return;
  await new Promise<void>((resolve, reject) => {
    const listeners: (() => void)[] = [];
    let settled = false;
    let grace: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout>;
    const fallback: { attempted: boolean; result?: boolean; error?: string } = { attempted: false };
    const killerFallback: { pid?: number; result?: boolean; error?: string }[] = [];
    let spawnError: string | undefined;
    const snapshot = (process: ChildProcess) => ({
      pid: process.pid,
      exitCode: process.exitCode,
      signalCode: process.signalCode,
      exit: hasExited(process),
      close: stateOf(process).close,
      error: stateOf(process).error,
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(grace);
      clearTimeout(deadline);
      for (const remove of listeners) remove();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (complete()) finish();
    };
    const listen = (
      process: ChildProcess,
      event: string,
      listener: (...args: unknown[]) => void,
    ) => {
      process.on(event, listener);
      listeners.push(() => process.off(event, listener));
    };
    const directlyKill = (process: ChildProcess) => {
      try {
        return { result: process.kill('SIGKILL') };
      } catch (error) {
        return { error: message(error) };
      }
    };
    const force = () => {
      if (settled || fallback.attempted) return;
      fallback.attempted = true;
      // Bound our own taskkill too; otherwise it can keep Playwright alive after rejection.
      for (const killer of state.killers) {
        if (!hasExited(killer) && killer.pid)
          killerFallback.push({ pid: killer.pid, ...directlyKill(killer) });
      }
      // Never signal an exited PID, including a target that only lacks its close event.
      if (!hasExited(child) && child.pid) Object.assign(fallback, directlyKill(child));
      check();
    };
    const observeKiller = (killer: ChildProcess) => {
      trackChild(killer);
      listen(killer, 'close', check);
      listen(killer, 'error', force);
      listen(killer, 'exit', (code) => {
        if (code !== 0) force();
      });
    };
    listen(child, 'close', check);
    // Keep error/exit distinct from close: neither alone permits deleting storage.
    listen(child, 'error', () => {});
    for (const killer of state.killers) observeKiller(killer);
    deadline = setTimeout(() => {
      if (complete()) return finish();
      finish(
        new Error(
          `Test process ${child.pid} did not stop within 10000ms; ` +
            `target=${JSON.stringify(snapshot(child))}; ` +
            `killer=${JSON.stringify(state.killers.slice(-2).map(snapshot))}; ` +
            `fallback=${JSON.stringify(fallback)}; ` +
            `killerFallback=${JSON.stringify(killerFallback)}; spawnError=${spawnError ?? 'none'}`,
        ),
      );
    }, 10000);
    grace = setTimeout(force, 5000);
    if (!hasExited(child) && child.pid && !state.killers.some((killer) => !stateOf(killer).close)) {
      if (dependencies.platform === 'win32') {
        try {
          const killer = dependencies.spawnKiller(child.pid);
          state.killers.push(killer);
          observeKiller(killer);
        } catch (error) {
          spawnError = message(error);
          force();
        }
      } else {
        try {
          dependencies.killGroup(child.pid);
        } catch {
          force();
        }
      }
    }
    check();
  });
}

export function createTestCleanup(
  children: ChildProcess[],
  removeDirectory: () => Promise<void>,
  terminate: (child: ChildProcess) => Promise<void> = stopChild,
) {
  let stopPromise: Promise<void> | undefined;
  return () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      const stopped = await Promise.allSettled(children.map((child) => terminate(child)));
      for (const result of stopped) if (result.status === 'rejected') throw result.reason;
      await removeDirectory();
    })().catch((error: unknown) => {
      stopPromise = undefined;
      throw error;
    });
    return stopPromise;
  };
}
