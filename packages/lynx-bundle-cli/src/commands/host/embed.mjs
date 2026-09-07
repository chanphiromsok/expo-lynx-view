import { Args, Command, Flags } from '@oclif/core';

import { embedMiniApp } from '../../host-embed.mjs';

export default class HostEmbed extends Command {
  static description = 'Build one independent mini app into the Expo host embedded fallback directory.';

  static examples = ['lynx host embed ../mart'];

  static args = { miniAppDirectory: Args.directory({ description: 'independent mini-app repository', exists: true, required: true }) };
  static flags = { json: Flags.boolean({ description: 'print JSON' }), platform: Flags.string({ options: ['ios', 'android'], default: 'ios' }) };

  async run() {
    const { args, flags } = await this.parse(HostEmbed);
    const result = await embedMiniApp({ miniAppDirectory: args.miniAppDirectory, platform: flags.platform });
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Embedded ${result.appId}/${result.feature} for ${result.platform}.`);
  }
}
