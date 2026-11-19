import { readFileSync } from 'node:fs';
import path from 'node:path';

export const testSetupToken = 'isolated-api-test-setup-token-with-at-least-32-characters';

export function readSetupToken(storage: string): string {
  return readFileSync(path.join(storage, '.setup-token'), 'utf8').trim();
}
