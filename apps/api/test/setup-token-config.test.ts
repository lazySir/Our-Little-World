import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareSetupToken } from '../src/setup-token';

const emptyDatabase = { space: { count: async () => 0 } } as never;

test('configured setup tokens accept 32 to 256 characters without writing a token file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-configured-setup-token-'));
  try {
    for (const length of [32, 256]) {
      const token = 'x'.repeat(length);
      assert.deepEqual(await prepareSetupToken(emptyDatabase, directory, token), { value: token });
    }
    await assert.rejects(readFile(path.join(directory, '.setup-token'), 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('configured setup tokens reject values longer than the setup form limit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-configured-setup-token-'));
  try {
    await assert.rejects(
      prepareSetupToken(emptyDatabase, directory, 'x'.repeat(257)),
      /SETUP_TOKEN must contain at least 32 bytes and no more than 256 characters/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('configured setup tokens reject values shorter than 32 bytes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-configured-setup-token-'));
  try {
    await assert.rejects(
      prepareSetupToken(emptyDatabase, directory, 'x'.repeat(31)),
      /SETUP_TOKEN must contain at least 32 bytes and no more than 256 characters/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
