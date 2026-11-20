import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from './db/client';

export type SetupToken = { value: string; filePath?: string };

export async function prepareSetupToken(
  db: Pick<PrismaClient, 'space'>,
  storage: string,
  configuredToken?: string,
): Promise<SetupToken | null> {
  if (await db.space.count()) return null;
  const configured = configuredToken?.trim();
  if (configured) {
    if (Buffer.byteLength(configured) < 32 || configured.length > 256)
      throw new Error('SETUP_TOKEN must contain at least 32 bytes and no more than 256 characters.');
    return { value: configured };
  }
  const filePath = path.join(storage, '.setup-token');
  try {
    const handle = await open(filePath, 'wx', 0o600);
    const value = randomBytes(32).toString('base64url');
    try {
      await handle.writeFile(`${value}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { value, filePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  const value = (await readFile(filePath, 'utf8')).trim();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== value)
    throw new Error(`Invalid first-run setup token file: ${filePath}`);
  return { value, filePath };
}

export function setupTokenMatches(supplied: unknown, expected: string | null): boolean {
  if (typeof supplied !== 'string' || !expected || Buffer.byteLength(expected) < 32) return false;
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export async function consumeSetupToken(token: SetupToken | null): Promise<void> {
  if (token?.filePath) await unlink(token.filePath).catch(() => undefined);
}
