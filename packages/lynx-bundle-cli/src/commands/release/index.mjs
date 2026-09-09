import { Args, Command, Flags } from '@oclif/core';

import { loadMiniAppConfigAsync, packMiniAppRelease } from '../../index.mjs';
import { uploadRelease } from '../../release-upload.mjs';

function releaseId(feature) {
  return `${feature}-${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}`;
}

function releaseVersion() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '.');
}

export default class Release extends Command {
  static description = 'Mini-app command: build, package, upload, and register one immutable cross-platform release.';

  static examples = [
    'lynx doctor',
    'lynx release',
    'lynx release --draft',
    'lynx release upload ./dist/lynx-releases/merchant-home-20260906T101930455Z',
  ];

  static args = {
    action: Args.string({ options: ['upload'] }),
    releaseDirectory: Args.directory({ exists: true }),
  };

  static flags = {
    draft: Flags.boolean({ description: 'build release.json and release.zip only; do not contact the Worker' }),
    json: Flags.boolean({ description: 'print the release result as JSON' }),
    config: Flags.file({ description: 'mini-app config path' }),
    'release-id': Flags.string({ description: 'immutable release ID' }),
    version: Flags.string({ description: 'display version' }),
    server: Flags.url({ description: 'delivery Worker base URL', env: 'LYNX_DELIVERY_SERVER' }),
    'api-key': Flags.string({ description: 'delivery API key', env: 'LYNX_DELIVERY_API_KEY' }),
    'r2-account-id': Flags.string({ description: 'R2 account ID', env: 'R2_ACCOUNT_ID' }),
    'r2-bucket-name': Flags.string({ description: 'R2 bucket name', env: 'R2_BUCKET_NAME' }),
    'r2-access-key-id': Flags.string({ description: 'R2 S3 access key ID', env: 'R2_ACCESS_KEY_ID' }),
    'r2-secret-access-key': Flags.string({ description: 'R2 S3 secret access key', env: 'R2_SECRET_ACCESS_KEY' }),
  };

  async run() {
    const { args, flags } = await this.parse(Release);
    if (args.action) {
      if (args.action !== 'upload' || !args.releaseDirectory) throw new Error('Use lynx release upload <release-directory>.');
      const result = await uploadRelease({
        releaseDirectory: args.releaseDirectory,
        server: flags.server,
        apiKey: flags['api-key'],
        r2: {
          accountId: flags['r2-account-id'] ?? process.env.CLOUDFLARE_ACCOUNT_ID,
          bucketName: flags['r2-bucket-name'] ?? process.env.LYNX_DELIVERY_R2_BUCKET,
          accessKeyId: flags['r2-access-key-id'],
          secretAccessKey: flags['r2-secret-access-key'],
        },
      });
      return this.log(flags.json ? JSON.stringify(result, null, 2) : `Uploaded: ${result.bundle.id} (${result.bundle.version})`);
    }
    const config = await loadMiniAppConfigAsync({ configPath: flags.config });
    const packed = packMiniAppRelease(config, {
      releaseId: flags['release-id'] ?? releaseId(config.feature),
      version: flags.version ?? releaseVersion(),
    });
    if (flags.draft) return this.log(JSON.stringify(packed, null, 2));
    if (!flags.server || !flags['api-key']) throw new Error('Set LYNX_DELIVERY_SERVER and LYNX_DELIVERY_API_KEY, or pass --server and --api-key.');
    const result = await uploadRelease({
      releaseDirectory: packed.outputDirectory,
      server: flags.server,
      apiKey: flags['api-key'],
      r2: {
        accountId: flags['r2-account-id'] ?? process.env.CLOUDFLARE_ACCOUNT_ID,
        bucketName: flags['r2-bucket-name'] ?? process.env.LYNX_DELIVERY_R2_BUCKET,
        accessKeyId: flags['r2-access-key-id'],
        secretAccessKey: flags['r2-secret-access-key'],
      },
    });
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Uploaded: ${result.bundle.id} (${result.bundle.version})`);
  }
}
