import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pagePath = (name: string) =>
  fileURLToPath(new URL('../src/pages/' + name + '.vue', import.meta.url));

test('edit forms expose native submit buttons for keyboard submission', () => {
  const cases = [
    ['ResourcePage', 1],
    ['LedgerPage', 1],
    ['MealsPage', 1],
    ['BabyPage', 2],
    ['SettingsPage', 3],
  ] as const;

  for (const [name, formCount] of cases) {
    const source = readFileSync(pagePath(name), 'utf8');
    assert.equal(
      (source.match(/@submit\.prevent=/g) || []).length,
      formCount,
      name + ' should keep its expected submit handlers',
    );
    assert.equal(
      (source.match(/native-type="submit"/g) || []).length,
      formCount,
      name + ' should provide a native submit button for each edit form',
    );
    assert.doesNotMatch(
      source,
      /@click="(?:submit|saveProfile|saveSpace|savePassword)"/,
      name + ' should submit through the form exactly once',
    );
  }
});
