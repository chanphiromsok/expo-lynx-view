import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Load the nearest generated delivery environment without replacing shell values. */
export function loadNearestDeliveryEnvironment(cwd = process.cwd()) {
  let directory = resolve(cwd);
  while (true) {
    const file = resolve(directory, '.env.lynx');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^#\s]*))\s*(?:#.*)?$/);
        if (!match || process.env[match[1]] !== undefined) continue;
        process.env[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
      }
      return file;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
