import path from 'node:path';
import { ensureStorage, loadEnvironment, projectRoot, runNpm, spawnNode, supervise } from './runtime.mts';

try {
  const environment = loadEnvironment();
  ensureStorage(environment);
  await runNpm(['run', 'db:migrate', '--workspace=@our-little-world/api'], { env: environment });
  const child = spawnNode(['dist/main.js'], {
    cwd: path.join(projectRoot, 'apps/api'), env: environment, detached: process.platform !== 'win32',
  });
  supervise([child]);
} catch (error) {
  console.error(`Container startup failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
