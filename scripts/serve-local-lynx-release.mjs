import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(repositoryRoot, '.local-lynx-server');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const host = argument('--host', '0.0.0.0');
const port = Number(argument('--port', '3000'));
const distArgument = argument('--dist', undefined);
const sourceRoot = distArgument
  ? resolve(repositoryRoot, distArgument)
  : resolve(repositoryRoot, 'apps', 'expo-lynx-example', 'assets');
const bundleSource = resolve(sourceRoot, distArgument ? 'main.lynx.bundle' : 'static.lynx');
const resourcesSource = resolve(sourceRoot, 'static');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(
    'Usage: pnpm serve:lynx-local [--host 0.0.0.0] [--port 3000] [--dist path/to/dist]'
  );
}
if (!existsSync(bundleSource)) {
  throw new Error(`Embedded Lynx bundle not found: ${bundleSource}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

mkdirSync(outputRoot, { recursive: true });
const bundleDestination = resolve(outputRoot, 'main.lynx.bundle');
cpSync(bundleSource, bundleDestination, { force: true });

const resources = filesBelow(resourcesSource).map((source) => {
  const resourcePath = `static/${relative(resourcesSource, source).split(sep).join('/')}`;
  const destination = resolve(outputRoot, resourcePath);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { force: true });
  return {
    path: resourcePath,
    url: resourcePath,
    sha256: sha256(source),
    bytes: statSync(source).size,
  };
});

const bundleHash = sha256(bundleDestination);
const manifest = {
  feature: process.env.LYNX_FEATURE ?? 'delivery',
  version: process.env.LYNX_RELEASE_VERSION ?? `local-${bundleHash.slice(0, 12)}`,
  minHostVersion: process.env.LYNX_MIN_HOST_VERSION ?? '1.0.0',
  lynxEngineVersion: '4.0.0',
  bundle: {
    url: 'main.lynx.bundle',
    sha256: bundleHash,
    bytes: statSync(bundleDestination).size,
  },
  resources,
  signature: '',
};
writeFileSync(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (process.argv.includes('--prepare-only')) {
  console.log(`Prepared remote release ${manifest.version} (${bundleHash}).`);
  process.exit(0);
}

const contentTypes = {
  '.bundle': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const requested = resolve(outputRoot, `.${pathname}`);
    const rootPrefix = outputRoot.endsWith(sep) ? outputRoot : `${outputRoot}${sep}`;
    if (
      !requested.startsWith(rootPrefix) ||
      !existsSync(requested) ||
      !statSync(requested).isFile()
    ) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[extname(requested).toLowerCase()] ?? 'application/octet-stream',
    });
    response.end(readFileSync(requested));
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : 'Bad request');
  }
});

server.listen(port, host, () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === 'IPv4' && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}/manifest.json`);
  console.log(`Prepared ${relative(repositoryRoot, outputRoot)}/`);
  console.log(`Source bundle:      ${bundleSource}`);
  console.log(`Simulator manifest: http://127.0.0.1:${port}/manifest.json`);
  for (const address of addresses) console.log(`Device manifest:    ${address}`);
  console.log('Press Ctrl+C to stop.');
});
