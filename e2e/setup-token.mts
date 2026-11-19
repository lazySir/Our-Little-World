import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readE2ESetupToken(): Promise<string> {
  if (process.env.E2E_SETUP_TOKEN) return process.env.E2E_SETUP_TOKEN;
  const storage = process.env.E2E_STORAGE_DIR;
  if (!storage) throw new Error('The isolated E2E storage directory is unavailable');
  return (await readFile(path.join(storage, '.setup-token'), 'utf8')).trim();
}
