import { Args, Command, Flags } from '@oclif/core';

import { embedMiniApp } from '../host-embed.mjs';
import { prepareHostRuntime, registerPreparedHostRuntime } from '../host-runtime.mjs';

export default class Host extends Command {
  static description = 'Embed a mini app, or prepare and register a native host runtime.';
  static examples = ['lynx host embed ../mart', 'lynx host prepare', 'lynx host prepare --platform ios', 'lynx host register --platform ios'];
  static args = {
    action: Args.string({ options: ['embed', 'prepare', 'register'], required: true }),
    miniAppDirectory: Args.directory({ description: 'mini-app repository for embed', exists: true }),
  };
  static flags = {
    register: Flags.boolean({ description: 'register immediately after prepare' }),
    json: Flags.boolean({ description: 'print JSON' }),
    platform: Flags.string({ description: 'limit prepare/register to one platform', options: ['ios', 'android'] }),
  };

  async run() {
    const { args, flags } = await this.parse(Host);
    if (args.action === 'embed') {
      const result = await embedMiniApp({ miniAppDirectory: args.miniAppDirectory });
      return this.log(flags.json ? JSON.stringify(result, null, 2) : `Embedded ${result.appId}/${result.feature}.`);
    }
    const platforms = flags.platform ? [flags.platform] : ['ios', 'android'];
    if (args.action === 'register') {
      const registrations = [];
      for (const platform of platforms) registrations.push(await registerPreparedHostRuntime({ platform }));
      return this.log(flags.json
        ? JSON.stringify({ registrations }, null, 2)
        : registrations.map((item) => `Registered ${item.appId} ${item.platform} ${item.appVersion} (build ${item.buildNumber}).`).join('\n'));
    }
    const prepared = [];
    for (const platform of platforms) prepared.push(await prepareHostRuntime({ platform }));
    const registrations = [];
    if (flags.register) {
      for (const platform of platforms) registrations.push(await registerPreparedHostRuntime({ platform }));
    }
    const result = flags.register ? { prepared, registrations } : { prepared };
    this.log(flags.json
      ? JSON.stringify(result, null, 2)
      : prepared.map((item) => `Prepared ${item.appId} ${item.platform} ${item.appVersion} (build ${item.buildNumber}).`).join('\n'));
  }
}
