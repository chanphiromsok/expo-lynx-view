import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema.ts';

/** Creates a request-scoped typed view of the Cloudflare D1 binding. */
export function createDeliveryDatabase(client: D1Database) {
  return drizzle(client, { schema });
}
