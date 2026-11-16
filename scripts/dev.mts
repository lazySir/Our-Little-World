import { ensureStorage, loadEnvironment, spawnNpm, supervise } from './runtime.mts';

try {
  const environment = loadEnvironment();
  ensureStorage(environment);
  console.log(`Web: http://localhost:5173 · API: http://localhost:${environment.PORT}/api · Ctrl+C stops both.`);
  const options = { env: environment, detached: process.platform !== 'win32' };
  const children = [
    spawnNpm(['run', 'dev', '--workspace=@our-little-world/api'], options),
    spawnNpm(['run', 'dev', '--workspace=@our-little-world/web'], options),
  ];
  supervise(children);
} catch (error) {
  console.error(`Development startup failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
