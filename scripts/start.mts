import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureStorage, loadEnvironment, projectRoot, spawnNode, supervise } from './runtime.mts';

try {
  const environment = loadEnvironment();
  if (!existsSync(path.join(environment.WEB_DIST_DIR, 'index.html'))) {
    throw new Error('Web build is missing. Run npm run build:web first');
  }
  if (!existsSync(path.join(projectRoot, 'apps/api/dist/main.js'))) {
    throw new Error('API build is missing. Run npm run build:api first');
  }
  ensureStorage(environment);
  console.log(`Our Little World: http://localhost:${environment.PORT} · Ctrl+C stops the server.`);
  const child = spawnNode(['dist/main.js'], {
    cwd: path.join(projectRoot, 'apps/api'), env: environment, detached: process.platform !== 'win32',
  });
  supervise([child]);
} catch (error) {
  console.error(`Startup failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
