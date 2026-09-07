import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const stateDirectory = '.wrangler/delivery-worker-v2';

await rm(stateDirectory, { recursive: true, force: true });

const migration = spawn(
  'pnpm',
  ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'lynx-delivery', '--local', '--persist-to', stateDirectory],
  { stdio: 'inherit' },
);

migration.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
