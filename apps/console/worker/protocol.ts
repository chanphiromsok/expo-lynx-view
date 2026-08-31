import {
  decodeEnvelopePayload,
  parseReleasePayload,
  parseSignedEnvelope,
  parseUnverifiedEnvelopePayload,
  type DeploymentPayload,
  type ReleasePayload,
  type SignedEnvelope,
} from '../../../packages/expo-lynx/src/ReleaseProtocol.ts';

const textEncoder = new TextEncoder();

export type VerifiedReleaseEnvelope = {
  envelope: SignedEnvelope;
  envelopeBytes: Uint8Array;
  envelopeSha256: string;
  payload: ReleasePayload;
};

export async function verifyReleaseEnvelope(
  envelopeText: string,
  publicKeyPem: string,
): Promise<VerifiedReleaseEnvelope> {
  const envelopeResult = parseSignedEnvelope(envelopeText);
  if (!envelopeResult.ok) throw envelopeResult.error;

  const payloadBytesResult = decodeEnvelopePayload(envelopeResult.value);
  if (!payloadBytesResult.ok) throw payloadBytesResult.error;
  const payloadBytes = payloadBytesResult.value;
  const publicKey = await importPublicKey(publicKeyPem);
  const signature = decodeBase64Url(envelopeResult.value.signature);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signature,
    payloadBytes,
  );
  if (!valid) throw new Error('The signed release envelope is not authorized.');

  const unverifiedPayload = parseUnverifiedEnvelopePayload(envelopeResult.value);
  if (!unverifiedPayload.ok) throw unverifiedPayload.error;
  const feature =
    typeof unverifiedPayload.value === 'object' &&
    unverifiedPayload.value !== null &&
    'feature' in unverifiedPayload.value &&
    typeof unverifiedPayload.value.feature === 'string'
      ? unverifiedPayload.value.feature
      : '';
  const payloadResult = parseReleasePayload(unverifiedPayload.value, feature);
  if (!payloadResult.ok) throw payloadResult.error;

  const envelopeBytes = textEncoder.encode(envelopeText);
  return {
    envelope: envelopeResult.value,
    envelopeBytes,
    envelopeSha256: await sha256Hex(envelopeBytes),
    payload: payloadResult.value,
  };
}

export async function signDeployment(
  payload: DeploymentPayload,
  privateKeyPem: string,
): Promise<{ envelopeText: string; envelopeSha256: string }> {
  const payloadBytes = textEncoder.encode(JSON.stringify(payload));
  const privateKey = await importPrivateKey(privateKeyPem);
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, payloadBytes),
  );
  const envelope: SignedEnvelope = {
    schemaVersion: 1,
    algorithm: 'RSA-SHA256',
    payload: encodeBase64Url(payloadBytes),
    signature: encodeBase64Url(signature),
  };
  const envelopeText = `${JSON.stringify(envelope)}\n`;
  return {
    envelopeText,
    envelopeSha256: await sha256Hex(textEncoder.encode(envelopeText)),
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    pemBytes(pem, 'PUBLIC KEY'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pemBytes(pem, 'PRIVATE KEY'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function pemBytes(pem: string, label: 'PUBLIC KEY' | 'PRIVATE KEY'): Uint8Array {
  const normalized = pem.replaceAll('\\n', '\n').trim();
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  if (!normalized.startsWith(begin) || !normalized.endsWith(end)) {
    throw new Error(`Expected a PEM ${label}.`);
  }
  const base64 = normalized.slice(begin.length, -end.length).replace(/\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat(
    (4 - (value.length % 4)) % 4,
  )}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
