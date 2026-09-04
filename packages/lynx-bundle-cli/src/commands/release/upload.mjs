import { Args, Command, Flags } from '@oclif/core';

import { uploadRelease } from '../../release-upload.mjs';

export default class ReleaseUpload extends Command {
  static args = {
    releaseDirectory: Args.directory({
      description: 'directory produced by lynx-bundle pack',
      exists: true,
      required: true,
    }),
  };

  static description =
    'Upload a packaged release.zip directly to R2, then register it with the delivery Worker.';

  static examples = [
    '<%= config.bin %> release upload ./dist/lynx-releases/delivery/delivery-20260901T011848990Z-ac8c0e --server https://delivery.example --api-key "$LYNX_DELIVERY_API_KEY"',
    'LYNX_DELIVERY_SERVER=http://127.0.0.1:8787 LYNX_DELIVERY_API_KEY=lynx_live_local_example <%= config.bin %> release upload ./dist/lynx-releases/delivery/delivery-20260830T143512-a1b2c3',
  ];

  static flags = {
    json: Flags.boolean({ description: 'print the completed bundle record as JSON' }),
    server: Flags.url({
      description: 'delivery Worker base URL',
      env: 'LYNX_DELIVERY_SERVER',
      required: true,
    }),
    'api-key': Flags.string({
      description: 'delivery API key (prefer LYNX_DELIVERY_API_KEY)',
      env: 'LYNX_DELIVERY_API_KEY',
      required: true,
    }),
    'r2-account-id': Flags.string({ description: 'R2 account ID (prefer R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID)', env: 'R2_ACCOUNT_ID' }),
    'r2-bucket-name': Flags.string({ description: 'R2 bucket name (prefer R2_BUCKET_NAME or LYNX_DELIVERY_R2_BUCKET)', env: 'R2_BUCKET_NAME' }),
    'r2-access-key-id': Flags.string({ description: 'R2 S3 access key ID (prefer R2_ACCESS_KEY_ID)', env: 'R2_ACCESS_KEY_ID' }),
    'r2-secret-access-key': Flags.string({ description: 'R2 S3 secret access key (prefer R2_SECRET_ACCESS_KEY)', env: 'R2_SECRET_ACCESS_KEY' }),
  };

  async run() {
    const { args, flags } = await this.parse(ReleaseUpload);
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

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    const action = result.created ? 'Uploaded' : 'Already verified';
    const version = result.bundle.version ? ` (${result.bundle.version})` : '';
    this.log(`${action}: ${result.bundle.id}${version}`);
    this.log('Open the console to select the bundle and enable the deployment.');
  }
}
