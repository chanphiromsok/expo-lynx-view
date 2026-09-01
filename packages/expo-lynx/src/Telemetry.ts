// Legacy prototype telemetry; V2 migration target: M11 mobile telemetry.
//
// Spec: feature/delivery-bundle-update/specs/v2/mobile/m11-mobile-telemetry-e2e.md
//
// Telemetry events are emitted by the native side. JS consumes them.
// This file enforces the "no PII" rule on the JS side: even if a
// native caller passes something that looks like a token, the JS
// receiver drops it before forwarding.

import type { LynxLoadEvent, LynxErrorEvent, LynxUpdateEvent } from './LynxSource';

const FORBIDDEN_SUBSTRINGS = [
  '?token=',
  '?auth=',
  '?key=',
  '?secret=',
  'authorization:',
  'Bearer ',
  'bearer ',
];

const MAX_MESSAGE_LENGTH = 500;
const MAX_URL_LENGTH = 200;

/** Strip everything after `?` in a URL. Keeps the host + path only. */
function redactUrl(url: string): string {
  const q = url.indexOf('?');
  const redacted = q >= 0 ? url.slice(0, q) : url;
  return redacted.slice(0, MAX_URL_LENGTH);
}

function containsForbidden(s: string): boolean {
  return FORBIDDEN_SUBSTRINGS.some((needle) => s.includes(needle));
}

export function safeLoadEvent(input: LynxLoadEvent): LynxLoadEvent | null {
  return {
    feature: input.feature,
    version: input.version,
    source: input.source,
    durationMs: Math.max(0, Math.min(input.durationMs, 60_000)),
  };
}

export function safeErrorEvent(input: LynxErrorEvent): LynxErrorEvent | null {
  const message = input.message.slice(0, MAX_MESSAGE_LENGTH);
  if (containsForbidden(message)) return null;
  return {
    feature: input.feature,
    stage: input.stage,
    code: input.code,
    message,
  };
}

/**
 * Normalise a native delivery update before it reaches an application-owned
 * analytics sink. Native events intentionally carry no URL/path fields; this
 * guard also discards an unexpected secret in an error message.
 */
export function safeUpdateEvent(input: LynxUpdateEvent): LynxUpdateEvent | null {
  if (input.message && containsForbidden(input.message)) return null;
  return {
    feature: input.feature,
    phase: input.phase,
    ...(input.releaseId ? { releaseId: input.releaseId.slice(0, 128) } : {}),
    ...(input.version ? { version: input.version.slice(0, 128) } : {}),
    ...(typeof input.revision === 'number' && Number.isSafeInteger(input.revision)
      ? { revision: Math.max(0, input.revision) }
      : {}),
    ...(input.code ? { code: input.code.slice(0, 128) } : {}),
    ...(input.message ? { message: input.message.slice(0, MAX_MESSAGE_LENGTH) } : {}),
    ...(typeof input.durationMs === 'number'
      ? { durationMs: Math.max(0, Math.min(input.durationMs, 60_000)) }
      : {}),
  };
}

/** Redact a URL for telemetry payloads. */
export function redactUrlForTelemetry(url: string): string {
  return redactUrl(url);
}
