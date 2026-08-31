import { spawn } from 'node:child_process';

const commands = [
  [
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--local',
      '--persist-to',
      '.wrangler/delivery-v2',
      '--port',
      '8787',
    ],
  ],
  ['pnpm', ['exec', 'vite', '--host', '127.0.0.1']],
];

const children = commands.map(([command, argumentsList]) =>
  spawn(command, argumentsList, {
    stdio: 'inherit',
  }),
);

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = exitCode;
}

for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', (code, signal) => {
    if (stopping) return;
    stop(code ?? (signal ? 1 : 0));
  });
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
