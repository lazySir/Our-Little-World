import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

/** Damage only the isolated service started by this Playwright run. */
export async function removeTestPhoto(
  archivePath: string,
  kind: 'web' | 'uni',
  mode: 'missing' | 'damaged' = 'missing',
) {
  const storage = process.env.E2E_STORAGE_DIR;
  assert.ok(storage, 'An isolated Playwright storage directory is required');
  const temporary = path.dirname(path.resolve(storage));
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  assert.ok(path.basename(temporary).startsWith(`little-world-${kind}-`));
  assert.equal(path.basename(storage), 'storage');
  const zip = new AdmZip(await readFile(archivePath));
  const { assets } = JSON.parse(zip.readAsText('data.json'));
  assert.ok(assets.length > 0, 'The backup must contain a real uploaded photo');
  const filename = assets[0].filename as string;
  assert.match(filename, /^[a-zA-Z0-9-]+\.webp$/);
  const target = path.join(storage, 'uploads', filename);
  if (mode === 'missing') await unlink(target);
  else await writeFile(target, Buffer.from('damaged test image'));
  return { target, bytes: zip.readFile(`uploads/${filename}`)! };
}
