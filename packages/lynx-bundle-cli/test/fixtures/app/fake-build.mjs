import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [feature, outputDirectory] = process.argv.slice(2);
if (!feature || !outputDirectory) throw new Error('Expected feature and output directory.');

const source = readFileSync(resolve('src/index.tsx'), 'utf8');
mkdirSync(resolve(outputDirectory, 'static'), { recursive: true });
writeFileSync(resolve(outputDirectory, 'main.lynx.bundle'), `bundle:${feature}:${source}`);
writeFileSync(resolve(outputDirectory, 'static', 'feature.txt'), `asset:${feature}`);
