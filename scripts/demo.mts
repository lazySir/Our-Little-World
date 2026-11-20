import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ensureStorage, loadEnvironment, runNpm } from './runtime.mts';

try {
  const environment = loadEnvironment();
  ensureStorage(environment);
  await runNpm(['run', 'build:api'], { env: environment });
  const file = environment.DATABASE_URL.slice(5).split('?')[0];
  if (existsSync(file)) {
    const require = createRequire(import.meta.url);
    const { createPrismaClient } = require('../apps/api/dist/db/client.js') as typeof import('../apps/api/src/db/client.js');
    const database = createPrismaClient(environment.DATABASE_URL);
    try {
      const tables = await database.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'",
      );
      if (tables.length) {
        const spaces = await database.space.count();
        if (spaces > 0) throw new Error('This database already has a space. Demo data will not overwrite it; use a separate DATABASE_URL and STORAGE_DIR.');
      }
    } finally {
      await database.$disconnect();
    }
  }
  await runNpm(['run', 'db:migrate', '--workspace=@our-little-world/api'], { env: environment });
  await runNpm(['run', 'demo', '--workspace=@our-little-world/api'], { env: environment });
  console.log('Demo content is ready. Save the generated temporary password, then start the application.');
} catch (error) {
  console.error(`Demo initialization failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
