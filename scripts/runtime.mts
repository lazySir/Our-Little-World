import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface RuntimeEnvironment extends NodeJS.ProcessEnv {
  DATABASE_URL: string;
  STORAGE_DIR: string;
  WEB_DIST_DIR: string;
  HOST: string;
  PORT: string;
  RUST_LOG: string;
  AUTO_BACKUP_HOURS: string;
  API_PROXY_TARGET: string;
}

/** Root .env paths have one meaning in npm, a direct launcher, and Docker. */
export function resolveEnvironment(root: string, input: NodeJS.ProcessEnv = process.env): RuntimeEnvironment {
  const environment = { ...input };
  const rawUrl = environment.DATABASE_URL || 'file:./data/world.db';
  if (!rawUrl.startsWith('file:') || rawUrl === 'file::memory:') {
    throw new Error('DATABASE_URL must point to a persistent SQLite file (file:./data/world.db)');
  }
  const [databasePath, query] = rawUrl.slice(5).split('?');
  if (!databasePath) throw new Error('DATABASE_URL is missing its SQLite file path');
  const absoluteDatabase = path.resolve(root, databasePath).replace(/\\/g, '/');
  environment.DATABASE_URL = `file:${absoluteDatabase}${query ? `?${query}` : ''}`;
  environment.STORAGE_DIR = path.resolve(root, environment.STORAGE_DIR || './storage');
  environment.WEB_DIST_DIR = path.resolve(root, environment.WEB_DIST_DIR || './apps/web/dist');
  environment.HOST ||= '0.0.0.0';
  environment.PORT ||= '3000';
  environment.RUST_LOG ||= 'info';
  environment.AUTO_BACKUP_HOURS ||= '24';
  const port = Number(environment.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const backupHours = Number(environment.AUTO_BACKUP_HOURS);
  if (!Number.isFinite(backupHours) || (backupHours !== 0 && (backupHours < 1 || backupHours > 596))) {
    throw new Error('AUTO_BACKUP_HOURS must be 0 (disabled) or between 1 and 596 hours');
  }
  environment.API_PROXY_TARGET ||= `http://127.0.0.1:${port}`;
  return environment as RuntimeEnvironment;
}

export function loadEnvironment({ requireSecret = true }: { requireSecret?: boolean } = {}) {
  const envPath = path.join(projectRoot, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const environment = resolveEnvironment(projectRoot);
  if (requireSecret && (!environment.ASSET_SECRET || environment.ASSET_SECRET.length < 32)) {
    throw new Error('Run npm run init first, or provide a persistent ASSET_SECRET with at least 32 characters');
  }
  return environment;
}

export function ensureStorage(environment: RuntimeEnvironment) {
  const databaseFile = environment.DATABASE_URL.slice(5).split('?')[0];
  mkdirSync(path.dirname(databaseFile), { recursive: true });
  mkdirSync(environment.STORAGE_DIR, { recursive: true });
}

export function spawnNode(args: string[], options: SpawnOptions = {}) {
  return spawn(process.execPath, args, { cwd: projectRoot, stdio: 'inherit', windowsHide: true, ...options });
}

export function spawnNpm(args: string[], options: SpawnOptions = {}) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.js$/i.test(npmCli)) return spawnNode([npmCli, ...args], options);
  // Only fixed workspace/script names reach this fallback; no user input is interpolated.
  return spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: projectRoot, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32', ...options,
  });
}

export function waitForExit(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited ${signal ? `with signal ${signal}` : `with code ${code}`}`));
    });
  });
}

export async function runNpm(args: string[], options?: SpawnOptions) {
  await waitForExit(spawnNpm(args, options));
}

export function stopChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const cleanup = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    cleanup.on('error', () => child.kill(signal));
    cleanup.once('exit', code => { if (code !== 0) child.kill(signal); });
  } else {
    try { process.kill(-child.pid!, signal); } catch { child.kill(signal); }
  }
}

export function supervise(children: ChildProcess[]) {
  let stopping = false;
  function stop(code: number, signal: NodeJS.Signals = 'SIGTERM') {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) stopChild(child, signal);
  }
  process.once('SIGINT', () => stop(0, 'SIGINT'));
  process.once('SIGTERM', () => stop(0));
  for (const child of children) {
    child.once('error', (error) => {
      console.error(error.message);
      stop(1);
    });
    child.once('exit', (code, signal) => {
      if (!stopping) stop(code === 0 && !signal ? 0 : 1);
    });
  }
}
