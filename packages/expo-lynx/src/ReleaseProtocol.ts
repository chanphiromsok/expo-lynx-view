/**
 * V2 delivery protocol. These parsers establish the shape and safety of data
 * only; callers must verify an envelope signature before trusting a decoded
 * payload for a network URL, cache namespace, or activation decision.
 *
 * Spec: feature/delivery-bundle-update/specs/v2/mobile/m01-shared-release-protocol.md
 */

export const RELEASE_PROTOCOL_SCHEMA_VERSION = 1 as const;
export const RELEASE_PROTOCOL_ALGORITHM = 'RSA-SHA256' as const;

export const RELEASE_PROTOCOL_LIMITS = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxSingleEntryBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxCompressionRatio: 100,
  maxPathUtf8Bytes: 512,
  maxPathDepth: 16,
} as const;

const MAX_ENVELOPE_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_ENVELOPE_SIGNATURE_BYTES = 16 * 1024;
const FEATURE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DISPLAY_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/;
const SHA_256 = /^[a-f0-9]{64}$/;

export type SignedEnvelope = {
  schemaVersion: typeof RELEASE_PROTOCOL_SCHEMA_VERSION;
  algorithm: typeof RELEASE_PROTOCOL_ALGORITHM;
  /** Strict unpadded base64url encoding of exact UTF-8 JSON payload bytes. */
  payload: string;
  /** Strict unpadded base64url RSA-SHA256 signature over decoded payload bytes. */
  signature: string;
};

/**
 * The direct Worker response consumed by the mobile updater. Its exact bytes
 * are authorized by the detached `lynx-signature` response header.
 */
export type DirectDeploymentPayload =
  | {
      schemaVersion: typeof RELEASE_PROTOCOL_SCHEMA_VERSION;
      type: 'lynx-deployment';
      feature: string;
      revision: number;
      enabled: false;
      runtimeVersion: string;
      issuedAt: string;
    }
  | {
      schemaVersion: typeof RELEASE_PROTOCOL_SCHEMA_VERSION;
      type: 'lynx-deployment';
      feature: string;
      revision: number;
      enabled: true;
      releaseId: string;
      version: string;
      runtimeVersion: string;
      archiveUrl: string;
      archiveSha256: string;
      archiveBytes: number;
      force: boolean;
      issuedAt: string;
    };

export type ReleaseCompatibility = {
  runtimeVersion: string;
  minHostVersion: string;
  lynxEngineVersion: string;
};

export type ReleaseArchive = {
  format: 'zip';
  /** HTTPS production URL or a safe relative URL resolved by the trusted endpoint. */
  url: string;
  sha256: string;
  bytes: number;
  uncompressedBytes: number;
  entryCount: number;
};

export type ReleaseFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type ReleasePayload = {
  type: 'lynx-release';
  feature: string;
  releaseId: string;
  version: string;
  platform: 'ios' | 'android';
  compatibility: ReleaseCompatibility;
  archive: ReleaseArchive;
  files: readonly ReleaseFile[];
};

export type ReleaseProtocolErrorCode =
  | 'invalid-json'
  | 'invalid-object'
  | 'unknown-field'
  | 'unsupported-schema-version'
  | 'unsupported-algorithm'
  | 'invalid-base64url'
  | 'payload-too-large'
  | 'signature-too-large'
  | 'invalid-utf8'
  | 'invalid-type'
  | 'feature-mismatch'
  | 'invalid-feature'
  | 'invalid-enabled'
  | 'invalid-release-id'
  | 'invalid-version'
  | 'invalid-revision'
  | 'invalid-url'
  | 'invalid-sha256'
  | 'invalid-size'
  | 'invalid-timestamp'
  | 'invalid-force'
  | 'invalid-platform'
  | 'invalid-archive-format'
  | 'archive-limit-exceeded'
  | 'archive-contract-mismatch'
  | 'invalid-path'
  | 'duplicate-path'
  | 'missing-main-bundle'
  | 'multiple-main-bundles';

export class ReleaseProtocolError extends Error {
  readonly name = 'ReleaseProtocolError';
  readonly code: ReleaseProtocolErrorCode;

  constructor(code: ReleaseProtocolErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type ProtocolParseResult<T> =
  { ok: true; value: T } | { ok: false; error: ReleaseProtocolError };

/** Parses the signed wrapper but deliberately does not verify its signature. */
export function parseSignedEnvelope(input: unknown): ProtocolParseResult<SignedEnvelope> {
  return parseResult(() => {
    const value = parseJsonObject(input);
    assertOnlyKeys(value, ['schemaVersion', 'algorithm', 'payload', 'signature']);
    assert(
      value.schemaVersion === RELEASE_PROTOCOL_SCHEMA_VERSION,
      'unsupported-schema-version',
      `Expected schemaVersion ${RELEASE_PROTOCOL_SCHEMA_VERSION}.`
    );
    assert(
      value.algorithm === RELEASE_PROTOCOL_ALGORITHM,
      'unsupported-algorithm',
      `Expected algorithm ${RELEASE_PROTOCOL_ALGORITHM}.`
    );
    assertString(value.payload, 'invalid-base64url', 'Envelope payload must be a string.');
    assertString(value.signature, 'invalid-base64url', 'Envelope signature must be a string.');

    const payload = decodeBase64Url(value.payload);
    const signature = decodeBase64Url(value.signature);
    assert(
      payload.byteLength <= MAX_ENVELOPE_PAYLOAD_BYTES,
      'payload-too-large',
      `Envelope payload exceeds ${MAX_ENVELOPE_PAYLOAD_BYTES} bytes.`
    );
    assert(
      signature.byteLength <= MAX_ENVELOPE_SIGNATURE_BYTES,
      'signature-too-large',
      `Envelope signature exceeds ${MAX_ENVELOPE_SIGNATURE_BYTES} bytes.`
    );

    return {
      schemaVersion: RELEASE_PROTOCOL_SCHEMA_VERSION,
      algorithm: RELEASE_PROTOCOL_ALGORITHM,
      payload: value.payload,
      signature: value.signature,
    };
  });
}

/** Decodes exact payload bytes. It does not authorize them; verify first. */
export function decodeEnvelopePayload(envelope: SignedEnvelope): ProtocolParseResult<Uint8Array> {
  return parseResult(() => {
    const bytes = decodeBase64Url(envelope.payload);
    assert(
      bytes.byteLength <= MAX_ENVELOPE_PAYLOAD_BYTES,
      'payload-too-large',
      `Envelope payload exceeds ${MAX_ENVELOPE_PAYLOAD_BYTES} bytes.`
    );
    return bytes;
  });
}

/**
 * Parses a direct deployment response after native code has verified the
 * detached response signature. expectedFeature is mandatory domain separation.
 */
export function parseDeploymentPayload(
  input: unknown,
  expectedFeature: string
): ProtocolParseResult<DirectDeploymentPayload> {
  return parseResult(() => {
    assertFeature(expectedFeature);
    const value = parseJsonObject(input);
    assert(
      value.schemaVersion === RELEASE_PROTOCOL_SCHEMA_VERSION,
      'unsupported-schema-version',
      `Expected schemaVersion ${RELEASE_PROTOCOL_SCHEMA_VERSION}.`
    );
    assert(
      value.type === 'lynx-deployment',
      'invalid-type',
      'Expected payload type lynx-deployment.'
    );
    assert(
      typeof value.enabled === 'boolean',
      'invalid-enabled',
      'Deployment enabled must be a boolean.'
    );
    assertOnlyKeys(
      value,
      value.enabled
        ? [
            'type',
            'schemaVersion',
            'feature',
            'revision',
            'enabled',
            'releaseId',
            'version',
            'runtimeVersion',
            'archiveUrl',
            'archiveSha256',
            'archiveBytes',
            'force',
            'issuedAt',
          ]
        : ['schemaVersion', 'type', 'feature', 'revision', 'enabled', 'runtimeVersion', 'issuedAt']
    );
    assertString(value.feature, 'invalid-feature', 'Deployment feature must be a string.');
    assertFeature(value.feature);
    assert(
      value.feature === expectedFeature,
      'feature-mismatch',
      `Expected feature '${expectedFeature}' but received '${value.feature}'.`
    );
    assertPositiveSafeInteger(
      value.revision,
      'invalid-revision',
      'Revision must be a positive safe integer.'
    );
    assertString(value.runtimeVersion, 'invalid-version', 'Runtime version must be a string.');
    assertProtocolVersion(value.runtimeVersion, 'runtimeVersion');
    assertString(value.issuedAt, 'invalid-timestamp', 'issuedAt must be an ISO-8601 timestamp.');
    assertTimestamp(value.issuedAt, 'issuedAt');

    if (!value.enabled) {
      return {
        schemaVersion: RELEASE_PROTOCOL_SCHEMA_VERSION,
        type: 'lynx-deployment',
        feature: value.feature,
        revision: value.revision,
        enabled: false,
        runtimeVersion: value.runtimeVersion,
        issuedAt: value.issuedAt,
      };
    }

    assertString(value.releaseId, 'invalid-release-id', 'Release ID must be a string.');
    assertReleaseId(value.releaseId);
    assertString(value.version, 'invalid-version', 'Release version must be a string.');
    assert(DISPLAY_VERSION.test(value.version), 'invalid-version', 'Release version is not safe.');
    assertString(value.runtimeVersion, 'invalid-version', 'Runtime version must be a string.');
    assertProtocolVersion(value.runtimeVersion, 'runtimeVersion');
    assertString(value.archiveUrl, 'invalid-url', 'Archive URL must be a string.');
    assertArtifactUrl(value.archiveUrl, 'archiveUrl');
    assertSha256(value.archiveSha256, 'archiveSha256');
    assertPositiveSafeInteger(
      value.archiveBytes,
      'invalid-size',
      'archiveBytes must be a positive safe integer.'
    );
    assert(
      value.archiveBytes <= RELEASE_PROTOCOL_LIMITS.maxArchiveBytes,
      'archive-limit-exceeded',
      'Archive exceeds the compiled archive-size ceiling.'
    );
    assert(typeof value.force === 'boolean', 'invalid-force', 'Force must be a boolean.');

    return {
      schemaVersion: RELEASE_PROTOCOL_SCHEMA_VERSION,
      type: 'lynx-deployment',
      feature: value.feature,
      revision: value.revision,
      enabled: true,
      releaseId: value.releaseId,
      version: value.version,
      runtimeVersion: value.runtimeVersion,
      archiveUrl: value.archiveUrl,
      archiveSha256: value.archiveSha256,
      archiveBytes: value.archiveBytes,
      force: value.force,
      issuedAt: value.issuedAt,
    };
  });
}

/**
 * Parses a release payload after the native verifier has authenticated the
 * envelope. expectedFeature is mandatory domain separation.
 */
export function parseReleasePayload(
  input: unknown,
  expectedFeature: string
): ProtocolParseResult<ReleasePayload> {
  return parseResult(() => {
    assertFeature(expectedFeature);
    const value = parseJsonObject(input);
    assert(value.type === 'lynx-release', 'invalid-type', 'Expected payload type lynx-release.');
    assertOnlyKeys(value, [
      'type',
      'feature',
      'releaseId',
      'version',
      'platform',
      'compatibility',
      'archive',
      'files',
    ]);
    assertString(value.feature, 'invalid-feature', 'Release feature must be a string.');
    assertFeature(value.feature);
    assert(
      value.feature === expectedFeature,
      'feature-mismatch',
      `Expected feature '${expectedFeature}' but received '${value.feature}'.`
    );
    assertString(value.releaseId, 'invalid-release-id', 'Release ID must be a string.');
    assertReleaseId(value.releaseId);
    assertString(value.version, 'invalid-version', 'Release version must be a string.');
    assert(DISPLAY_VERSION.test(value.version), 'invalid-version', 'Release version is not safe.');
    assert(
      value.platform === 'ios' || value.platform === 'android',
      'invalid-platform',
      'Platform must be ios or android.'
    );

    const compatibility = parseCompatibility(value.compatibility);
    const archive = parseArchive(value.archive);
    const files = parseReleaseFiles(value.files);
    const totalFileBytes = files.reduce((total, file) => total + file.bytes, 0);
    assert(
      totalFileBytes === archive.uncompressedBytes,
      'archive-contract-mismatch',
      'archive.uncompressedBytes must equal the sum of declared file bytes.'
    );
    assert(
      files.length === archive.entryCount,
      'archive-contract-mismatch',
      'archive.entryCount must equal the number of declared files.'
    );
    const mainBundleCount = files.filter((file) => file.path === 'main.lynx.bundle').length;
    assert(
      mainBundleCount > 0,
      'missing-main-bundle',
      'Release files must contain main.lynx.bundle exactly once.'
    );
    assert(
      mainBundleCount === 1,
      'multiple-main-bundles',
      'Release files must contain main.lynx.bundle exactly once.'
    );

    return {
      type: 'lynx-release',
      feature: value.feature,
      releaseId: value.releaseId,
      version: value.version,
      platform: value.platform,
      compatibility,
      archive,
      files,
    };
  });
}

/** Decode a signed envelope payload as JSON, without performing verification. */
export function parseUnverifiedEnvelopePayload(
  envelope: SignedEnvelope
): ProtocolParseResult<unknown> {
  return parseResult(() => {
    const bytes = unwrap(decodeEnvelopePayload(envelope));
    let json: string;
    try {
      json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      throw new ReleaseProtocolError('invalid-utf8', 'Envelope payload is not valid UTF-8.');
    }
    try {
      return JSON.parse(json) as unknown;
    } catch {
      throw new ReleaseProtocolError('invalid-json', 'Envelope payload is not valid JSON.');
    }
  });
}

/** Strict unpadded base64url decoding used by all V2 envelope readers. */
export function decodeBase64Url(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
    throw new ReleaseProtocolError('invalid-base64url', 'Expected unpadded base64url data.');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const char of input) {
    const value = alphabet.indexOf(char);
    if (value < 0)
      throw new ReleaseProtocolError('invalid-base64url', 'Invalid base64url character.');
    accumulator = (accumulator << 6) | value;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  const decoded = new Uint8Array(bytes);
  if (encodeBase64Url(decoded) !== input) {
    throw new ReleaseProtocolError('invalid-base64url', 'Base64url encoding is not canonical.');
  }
  return decoded;
}

function parseCompatibility(input: unknown): ReleaseCompatibility {
  const value = asObject(input);
  assertOnlyKeys(value, ['runtimeVersion', 'minHostVersion', 'lynxEngineVersion']);
  assertProtocolVersion(value.runtimeVersion, 'compatibility.runtimeVersion');
  assertProtocolVersion(value.minHostVersion, 'compatibility.minHostVersion');
  assertProtocolVersion(value.lynxEngineVersion, 'compatibility.lynxEngineVersion');
  return {
    runtimeVersion: value.runtimeVersion as string,
    minHostVersion: value.minHostVersion as string,
    lynxEngineVersion: value.lynxEngineVersion as string,
  };
}

function parseArchive(input: unknown): ReleaseArchive {
  const value = asObject(input);
  assertOnlyKeys(value, ['format', 'url', 'sha256', 'bytes', 'uncompressedBytes', 'entryCount']);
  assert(value.format === 'zip', 'invalid-archive-format', 'Archive format must be zip.');
  assertString(value.url, 'invalid-url', 'Archive URL must be a string.');
  assertArtifactUrl(value.url, 'archive.url');
  assertSha256(value.sha256, 'archive.sha256');
  assertPositiveSafeInteger(
    value.bytes,
    'invalid-size',
    'archive.bytes must be a positive safe integer.'
  );
  assertPositiveSafeInteger(
    value.uncompressedBytes,
    'invalid-size',
    'archive.uncompressedBytes must be a positive safe integer.'
  );
  assertPositiveSafeInteger(
    value.entryCount,
    'invalid-size',
    'archive.entryCount must be a positive safe integer.'
  );
  assert(
    value.bytes <= RELEASE_PROTOCOL_LIMITS.maxArchiveBytes,
    'archive-limit-exceeded',
    'Archive exceeds the compiled archive-size ceiling.'
  );
  assert(
    value.uncompressedBytes <= RELEASE_PROTOCOL_LIMITS.maxUncompressedBytes,
    'archive-limit-exceeded',
    'Archive exceeds the compiled uncompressed-size ceiling.'
  );
  assert(
    value.entryCount <= RELEASE_PROTOCOL_LIMITS.maxEntries,
    'archive-limit-exceeded',
    'Archive exceeds the compiled entry-count ceiling.'
  );
  assert(
    value.uncompressedBytes / value.bytes <= RELEASE_PROTOCOL_LIMITS.maxCompressionRatio,
    'archive-limit-exceeded',
    'Archive exceeds the compiled compression-ratio ceiling.'
  );
  return {
    format: 'zip',
    url: value.url,
    sha256: value.sha256,
    bytes: value.bytes,
    uncompressedBytes: value.uncompressedBytes,
    entryCount: value.entryCount,
  };
}

function parseReleaseFiles(input: unknown): readonly ReleaseFile[] {
  assert(Array.isArray(input), 'invalid-object', 'Release files must be an array.');
  const paths = new Set<string>();
  let sawMainBundle = false;
  return input.map((entry): ReleaseFile => {
    const value = asObject(entry);
    assertOnlyKeys(value, ['path', 'bytes', 'sha256']);
    assertString(value.path, 'invalid-path', 'Release file path must be a string.');
    assertSafeRelativePath(value.path);
    const normalizedPath = value.path.normalize('NFC');
    assert(
      normalizedPath === value.path,
      'invalid-path',
      'Release file paths must use NFC Unicode normalization.'
    );
    if (value.path === 'main.lynx.bundle') {
      assert(
        !sawMainBundle,
        'multiple-main-bundles',
        'Release contains main.lynx.bundle more than once.'
      );
      sawMainBundle = true;
    }
    // iOS application storage is normally case-insensitive; fail before two
    // ZIP entries can collapse into one destination at extraction time.
    const storagePath = normalizedPath.toLowerCase();
    assert(!paths.has(storagePath), 'duplicate-path', `Duplicate release file path: ${value.path}`);
    paths.add(storagePath);
    assertPositiveSafeInteger(
      value.bytes,
      'invalid-size',
      `File ${value.path} has an invalid size.`
    );
    assert(
      value.bytes <= RELEASE_PROTOCOL_LIMITS.maxSingleEntryBytes,
      'archive-limit-exceeded',
      `File ${value.path} exceeds the single-entry ceiling.`
    );
    assertSha256(value.sha256, `files.${value.path}.sha256`);
    return { path: value.path, bytes: value.bytes, sha256: value.sha256 };
  });
}

function parseJsonObject(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      return asObject(JSON.parse(input) as unknown);
    } catch (error) {
      if (error instanceof ReleaseProtocolError) throw error;
      throw new ReleaseProtocolError('invalid-json', 'Expected valid JSON object.');
    }
  }
  return asObject(input);
}

function asObject(input: unknown): Record<string, unknown> {
  assert(
    input !== null && typeof input === 'object' && !Array.isArray(input),
    'invalid-object',
    'Expected an object.'
  );
  return input as Record<string, unknown>;
}

function assertOnlyKeys(object: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(object)) {
    assert(allowed.includes(key), 'unknown-field', `Unknown protocol field: ${key}.`);
  }
}

function assertFeature(feature: string): void {
  assert(
    FEATURE_ID.test(feature),
    'invalid-feature',
    'Feature is not a safe canonical identifier.'
  );
}

function assertReleaseId(releaseId: string): void {
  assert(RELEASE_ID.test(releaseId), 'invalid-release-id', 'Release ID is not a safe identifier.');
}

function assertProtocolVersion(value: unknown, field: string): asserts value is string {
  assertString(value, 'invalid-version', `${field} must be a string.`);
  assert(
    value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value),
    'invalid-version',
    `${field} must be a non-empty printable protocol version.`
  );
}

function assertTimestamp(value: string, field: string): void {
  assert(
    Number.isFinite(Date.parse(value)) && /T.*Z$/.test(value),
    'invalid-timestamp',
    `${field} must be a UTC ISO-8601 timestamp.`
  );
}

function assertArtifactUrl(value: string, field: string): void {
  assert(
    value.length > 0 && value.length <= 2048 && !/[\x00-\x1f\x7f\\]/.test(value),
    'invalid-url',
    `${field} is not a safe URL.`
  );
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ReleaseProtocolError('invalid-url', `${field} is not a valid HTTP(S) URL.`);
    }
    assert(
      url.protocol === 'https:' || url.protocol === 'http:',
      'invalid-url',
      `${field} must use HTTP(S).`
    );
    assert(
      url.hostname.length > 0 && url.username.length === 0 && url.password.length === 0,
      'invalid-url',
      `${field} must not contain credentials.`
    );
    assert(
      url.hash.length === 0 && url.search.length === 0,
      'invalid-url',
      `${field} must not contain a query or fragment.`
    );
    return;
  }
  assert(
    !value.startsWith('//') && !value.includes('?') && !value.includes('#') && !value.includes(':'),
    'invalid-url',
    `${field} must be an HTTP(S) URL or a safe relative artifact URL.`
  );
  assertSafeRelativePath(value.startsWith('/') ? value.slice(1) : value);
}

function assertSafeRelativePath(path: string): void {
  const utf8Length = new TextEncoder().encode(path).byteLength;
  assert(
    utf8Length > 0 && utf8Length <= RELEASE_PROTOCOL_LIMITS.maxPathUtf8Bytes,
    'invalid-path',
    'Path exceeds the UTF-8 byte limit.'
  );
  assert(
    !path.startsWith('/') && !path.includes('\\') && !path.includes('\0'),
    'invalid-path',
    'Path must be relative and use forward slashes only.'
  );
  const components = path.split('/');
  assert(
    components.length <= RELEASE_PROTOCOL_LIMITS.maxPathDepth,
    'invalid-path',
    'Path exceeds the maximum directory depth.'
  );
  for (const component of components) {
    assert(
      component.length > 0 && component !== '.' && component !== '..',
      'invalid-path',
      'Path contains an empty or traversal component.'
    );
    let decoded: string;
    try {
      decoded = decodeURIComponent(component);
    } catch {
      throw new ReleaseProtocolError('invalid-path', 'Path contains invalid percent encoding.');
    }
    assert(
      decoded.length > 0 && decoded !== '.' && decoded !== '..' && !/[\\/\0]/.test(decoded),
      'invalid-path',
      'Path contains an encoded traversal or separator.'
    );
  }
}

function assertSha256(value: unknown, field: string): asserts value is string {
  assertString(value, 'invalid-sha256', `${field} must be a SHA-256 string.`);
  assert(
    SHA_256.test(value),
    'invalid-sha256',
    `${field} must be lowercase 64-character hexadecimal SHA-256.`
  );
}

function assertPositiveSafeInteger(
  value: unknown,
  code: ReleaseProtocolErrorCode,
  message: string
): asserts value is number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, code, message);
}

function assertString(
  value: unknown,
  code: ReleaseProtocolErrorCode,
  message: string
): asserts value is string {
  assert(typeof value === 'string', code, message);
}

function assert(
  condition: unknown,
  code: ReleaseProtocolErrorCode,
  message: string
): asserts condition {
  if (!condition) throw new ReleaseProtocolError(code, message);
}

function parseResult<T>(parse: () => T): ProtocolParseResult<T> {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    if (error instanceof ReleaseProtocolError) return { ok: false, error };
    return {
      ok: false,
      error: new ReleaseProtocolError('invalid-object', 'Invalid protocol input.'),
    };
  }
}

function unwrap<T>(result: ProtocolParseResult<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) output += alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) output += alphabet[third & 0x3f];
  }
  return output;
}
