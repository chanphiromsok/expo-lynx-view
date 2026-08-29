import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = process.argv[2];
if (!outputDir) throw new Error('Expected the S01 {outputDir} argument.');
const sourceBundle = resolve(appRoot, 'assets/static.lynx');
const sourceStatic = resolve(appRoot, 'assets/static');
if (!existsSync(sourceBundle)) throw new Error(`Embedded bundle not found: ${sourceBundle}`);
mkdirSync(outputDir, { recursive: true });
cpSync(sourceBundle, resolve(outputDir, 'main.lynx.bundle'));
if (existsSync(sourceStatic)) cpSync(sourceStatic, resolve(outputDir, 'static'), { recursive: true });
