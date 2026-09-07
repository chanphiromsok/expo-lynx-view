import { Args, Command, Flags } from '@oclif/core';

import { prepareHostRuntime, registerPreparedHostRuntime } from '../../host-runtime.mjs';
import { embedMiniApp } from '../../host-embed.mjs';

export default class Host extends Command {
  static description = 'Build, prepare, and register an Expo host runtime before mini apps can publish to it.';

  static examples = [
    'lynx host embed ../mart',
    'lynx host prepare',
    'lynx host register',
  ];

  static args = {
    action: Args.string({ description: 'embed, prepare, or register the host runtime', options: ['embed', 'prepare', 'register'], required: true }),
    miniAppDirectory: Args.directory({ description: 'mini-app repository for embed', exists: true }),
  };
  static flags = { register: Flags.boolean(), json: Flags.boolean(), platform: Flags.string({ options: ['ios', 'android'], default: 'ios' }) };

  async run() {
    const { args, flags } = await this.parse(Host);
    if (args.action === 'embed') {
      const result = await embedMiniApp({ miniAppDirectory: args.miniAppDirectory, platform: flags.platform });
      return this.log(flags.json ? JSON.stringify(result, null, 2) : `Embedded ${result.appId}/${result.feature} for ${result.platform}.`);
    }
    if (args.action === 'register') {
      const result = await registerPreparedHostRuntime({ platform: flags.platform });
      return this.log(flags.json ? JSON.stringify(result, null, 2) : `Registered ${result.appId} ${result.appVersion} (build ${result.buildNumber}).`);
    }
    const prepared = await prepareHostRuntime({ platform: flags.platform });
    const result = flags.register ? { prepared, registration: await registerPreparedHostRuntime({ platform: flags.platform }) } : { prepared };
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Prepared ${prepared.appId} ${prepared.appVersion} (build ${prepared.buildNumber}).`);
  }
}
