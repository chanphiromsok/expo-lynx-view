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
    'Upload a packaged release.json and release.zip through one direct Worker-issued PUT.';

  static examples = [
    '<%= config.bin %> release upload ./dist/lynx-releases/delivery/delivery-20260901T011848990Z-ac8c0e --server https://delivery.example --token "$LYNX_DELIVERY_CONTROL_TOKEN"',
    'LYNX_DELIVERY_SERVER=http://127.0.0.1:8787 LYNX_DELIVERY_CONTROL_TOKEN=local-token <%= config.bin %> release upload ./dist/lynx-releases/delivery/delivery-20260830T143512-a1b2c3',
  ];

  static flags = {
    json: Flags.boolean({ description: 'print the completed bundle record as JSON' }),
    server: Flags.url({
      description: 'delivery Worker base URL',
      env: 'LYNX_DELIVERY_SERVER',
      required: true,
    }),
    token: Flags.string({
      description: 'delivery control token (prefer LYNX_DELIVERY_CONTROL_TOKEN)',
      env: 'LYNX_DELIVERY_CONTROL_TOKEN',
      required: true,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(ReleaseUpload);
    const result = await uploadRelease({
      releaseDirectory: args.releaseDirectory,
      server: flags.server,
      token: flags.token,
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
