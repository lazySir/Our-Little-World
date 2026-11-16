import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureStorage, loadEnvironment, projectRoot, runNpm } from './runtime.mts';

try {
  const envPath = path.join(projectRoot, '.env');
  let content = readFileSync(existsSync(envPath) ? envPath : path.join(projectRoot, '.env.example'), 'utf8');
  const secretLine = /^ASSET_SECRET[ \t]*=[ \t]*([^\r\n]*)$/m.exec(content);
  if (!secretLine || !secretLine[1].trim().replace(/^(['"])(.*)\1$/, '$2')) {
    const generated = randomBytes(48).toString('hex');
    content = secretLine
      ? content.replace(/^ASSET_SECRET[ \t]*=[^\r\n]*$/m, `ASSET_SECRET=${generated}`)
      : `${content.trimEnd()}\nASSET_SECRET=${generated}\n`;
  }
  if (!existsSync(envPath) || content !== readFileSync(envPath, 'utf8')) {
    writeFileSync(envPath, content, { mode: 0o600 });
  }
  const environment = loadEnvironment();
  ensureStorage(environment);
  if (process.argv.includes('--config-only')) {
    console.log('Local configuration is ready. The private asset signing secret is saved in .env.');
  } else {
    await runNpm(['run', 'db:generate', '--workspace=@our-little-world/api'], { env: environment });
    await runNpm(['run', 'db:migrate', '--workspace=@our-little-world/api'], { env: environment });
    console.log('Database is ready. Create your own account in the first-run page.');
  }
} catch (error) {
  console.error(`Initialization failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
