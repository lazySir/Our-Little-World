import { appendFile, cp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface VerificationOptions {
  automationPort: number;
  idePort: number;
  timeoutMs: number;
}

export function verificationResult(
  state: {
    hasPrimaryError: boolean;
    primaryError?: unknown;
    stage: string;
    cleanupErrors: readonly string[];
  },
  redact: (value: unknown) => string,
) {
  return {
    ok: !state.hasPrimaryError && state.cleanupErrors.length === 0,
    failedAt: state.hasPrimaryError ? state.stage : undefined,
    error: state.hasPrimaryError ? redact(state.primaryError) : undefined,
    cleanupErrors: [...state.cleanupErrors],
  };
}

export function verificationOptions(environment: NodeJS.ProcessEnv): VerificationOptions {
  const integer = (name: string, fallback: number, minimum: number, maximum: number) => {
    const raw = environment[name] || String(fallback);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
    }
    return value;
  };
  const automationPort = integer('WECHAT_AUTO_PORT', 9431, 1, 65535);
  const idePort = integer('WECHAT_IDE_PORT', 9432, 1, 65535);
  if (automationPort === idePort)
    throw new Error('WECHAT_AUTO_PORT and WECHAT_IDE_PORT must use different ports');
  return {
    automationPort,
    idePort,
    timeoutMs: integer('WECHAT_TIMEOUT_MS', 240000, 1000, 1800000),
  };
}

/** Bind instead of connecting: an existing automation service is never queried or reused. */
export async function assertAutomationPortFree(port: number): Promise<void> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `WeChat automation port ${port} is already in use; select another WECHAT_AUTO_PORT`
            : error.message,
        ),
      ),
    );
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

export async function createVerificationProject(
  source: string,
  destination: string,
  runId: string,
) {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Invalid verification run identifier');
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (file) => path.basename(file) !== 'project.private.config.json',
  });
  const configFile = path.join(destination, 'project.config.json');
  const config = JSON.parse(await readFile(configFile, 'utf8')) as {
    appid: string;
    projectname: string;
    setting?: Record<string, unknown>;
    [key: string]: unknown;
  };
  config.appid = 'touristappid';
  config.projectname = `little-world-verify-${runId}`;
  config.setting = { ...config.setting, urlCheck: false };
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const marker = `little-world-wechat:${runId}`;
  // Tourist simulators cannot reliably read code-package files with wx.fs.
  // Append only to our disposable copy; the app itself exposes the identity to evaluate().
  await appendFile(
    path.join(destination, 'app.js'),
    `\n;getApp().__worldVerificationMarker = ${JSON.stringify(marker)};\n`,
  );
  return { marker };
}

export async function assertProjectIdentity(
  readMarker: () => Promise<unknown>,
  expected: string,
): Promise<void> {
  let actual: unknown;
  try {
    actual = await readMarker();
  } catch (cause) {
    throw new Error('Cannot verify WeChat project identity; refusing to change its state', {
      cause,
    });
  }
  if (actual !== expected)
    throw new Error('WeChat project identity mismatch; refusing to change its state');
}

/** The CLI may report success before its automation listener is accepting connections. */
export async function connectAfterLaunch<T>(
  connect: () => Promise<T>,
  options: {
    timeoutMs: number;
    intervalMs?: number;
    signal?: AbortSignal;
    lateResult?: (value: T) => void | Promise<void>;
  },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    try {
      return await runBounded(connect, {
        label: 'WeChat automation connection',
        timeoutMs: Math.max(1, deadline - Date.now()),
        signal: options.signal,
        lateResult: options.lateResult,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (
        !(error instanceof Error) ||
        !/^(Failed connecting to |Connection closed, check)/.test(error.message)
      )
        throw error;
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0)
      await delay(Math.min(options.intervalMs ?? 350, remaining), undefined, {
        signal: options.signal,
      });
  }
  throw new Error('Timed out: WeChat automation connection after launch', { cause: lastError });
}

/** An open automation socket does not guarantee that App commands can execute yet. */
export async function waitForAppReady<T>(
  readOnlyProbe: () => Promise<T | undefined | null | false>,
  options: {
    timeoutMs: number;
    attemptTimeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    try {
      // A swallowed read can finish late safely; never use this for mutating commands.
      const result = await runBounded(readOnlyProbe, {
        label: 'WeChat App readiness read',
        timeoutMs: Math.max(1, Math.min(options.attemptTimeoutMs ?? 1000, deadline - Date.now())),
        signal: options.signal,
      });
      if (result) return result;
    } catch (error) {
      options.signal?.throwIfAborted();
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0)
      await delay(Math.min(options.intervalMs ?? 150, remaining), undefined, {
        signal: options.signal,
      });
  }
  throw new Error('Timed out: WeChat App readiness', { cause: lastError });
}

/** SDK calls do not support AbortSignal; race them while disposing of a late connection. */
export function runBounded<T>(
  operation: () => Promise<T>,
  options: {
    label: string;
    timeoutMs: number;
    signal?: AbortSignal;
    lateResult?: (value: T) => void | Promise<void>;
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (success: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (success) resolve(value as T);
      else reject(value);
    };
    const abort = () =>
      finish(false, options.signal?.reason || new Error('WeChat verification interrupted'));
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(
      () => finish(false, new Error(`Timed out: ${options.label}`)),
      options.timeoutMs,
    );
    Promise.resolve()
      .then(() => {
        options.signal?.throwIfAborted();
        return operation();
      })
      .then(
        (value) => {
          if (settled)
            void Promise.resolve()
              .then(() => options.lateResult?.(value))
              .catch(() => {});
          else finish(true, value);
        },
        (error) => finish(false, error),
      );
  });
}
