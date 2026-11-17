import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBackupBudget, BackupLimitError } from '../src/backup-limits';

const tiny = {
  records: 2,
  assets: 2,
  users: 2,
  zipEntries: 5,
  expandedBytes: 10,
  zipBytes: 10,
  assetBytes: 10,
};

test('backup budget accepts every exact boundary and rejects the next unit', () => {
  assert.doesNotThrow(() => assertBackupBudget(tiny, tiny));
  for (const key of Object.keys(tiny) as (keyof typeof tiny)[]) {
    const over = { ...tiny, [key]: tiny[key] + 1 };
    assert.throws(() => assertBackupBudget(over, tiny), BackupLimitError, key);
  }
});

test('zip member budget includes the three fixed backup members', () => {
  assert.doesNotThrow(() => assertBackupBudget({ assets: 2, zipEntries: 5 }, tiny));
  assert.throws(() => assertBackupBudget({ assets: 2, zipEntries: 6 }, tiny), BackupLimitError);
});
