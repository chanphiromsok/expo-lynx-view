import { AwsClient } from 'aws4fetch';

export type R2PresignConfiguration = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
};

export async function presignR2Put(
  configuration: R2PresignConfiguration,
  key: string,
  contentType: string,
  checksumBase64: string,
  expiresInSeconds = 900,
): Promise<{ url: string; headers: Record<string, string> }> {
  const client = new AwsClient({
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    region: 'auto',
    service: 's3',
  });
  const path = [configuration.bucketName, ...key.split('/')]
    .map(encodeURIComponent)
    .join('/');
  const url = new URL(
    `https://${configuration.accountId}.r2.cloudflarestorage.com/${path}`,
  );
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  const headers = {
    'content-type': contentType,
    'if-none-match': '*',
    'x-amz-checksum-sha256': checksumBase64,
  };
  const signed = await client.sign(
    new Request(url, { method: 'PUT', headers }),
    { aws: { signQuery: true } },
  );
  return { url: signed.url, headers };
}
