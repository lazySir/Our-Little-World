import { loadEnvironment } from './runtime.mts';

try {
  const base = (process.argv[2] || `http://127.0.0.1:${loadEnvironment({ requireSecret: false }).PORT}`).replace(/\/$/, '');
  const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json() as { ok?: unknown } | null;
  if (result?.ok !== true) throw new Error('The response did not confirm API health');
  console.log(`Server is responding: ${base}/api/health`);
} catch (error) {
  console.error(`Server health check failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
