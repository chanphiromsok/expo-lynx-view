import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";

export interface Env {
  ARTIFACTS: R2Bucket;
  DB: D1Database;
}

export const app = new Elysia({ adapter: CloudflareAdapter })
  .get("/", () => "hello world")
  .get("/health", () => ({ ok: true }))
  .compile();

export default app;
