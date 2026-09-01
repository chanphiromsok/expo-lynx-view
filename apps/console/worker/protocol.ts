const textEncoder = new TextEncoder();

export type SignedDocument = {
  body: Uint8Array;
  signature: string;
};

/**
 * Authorizes the exact UTF-8 response bytes. The document is intentionally
 * ordinary JSON: mobile verifies `lynx-signature` before it parses the body.
 */
export async function signDocument(
  document: unknown,
  privateKeyPem: string,
): Promise<SignedDocument> {
  const body = textEncoder.encode(JSON.stringify(document));
  const privateKey = await importPrivateKey(privateKeyPem);
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, body),
  );
  return { body, signature: encodeBase64Url(signature) };
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

function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pemBytes(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function pemBytes(pem: string): Uint8Array {
  const normalized = pem.replaceAll('\\n', '\n').trim();
  const begin = '-----BEGIN PRIVATE KEY-----';
  const end = '-----END PRIVATE KEY-----';
  if (!normalized.startsWith(begin) || !normalized.endsWith(end)) {
    throw new Error('Expected a PKCS#8 RSA private key.');
  }
  const base64 = normalized.slice(begin.length, -end.length).replace(/\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
