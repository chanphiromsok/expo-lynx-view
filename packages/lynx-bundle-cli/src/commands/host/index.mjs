import { Args, Command, Flags } from '@oclif/core';

import { prepareHostRuntime, registerPreparedHostRuntime } from '../../host-runtime.mjs';

export default class Host extends Command {
  static args = { action: Args.string({ options: ['prepare', 'register'], required: true }) };
  static flags = { register: Flags.boolean(), json: Flags.boolean() };

  async run() {
    const { args, flags } = await this.parse(Host);
    if (args.action === 'register') {
      const result = await registerPreparedHostRuntime();
      return this.log(flags.json ? JSON.stringify(result, null, 2) : `Registered ${result.appId} ${result.appVersion} (build ${result.buildNumber}).`);
    }
    const prepared = await prepareHostRuntime();
    const result = flags.register ? { prepared, registration: await registerPreparedHostRuntime() } : { prepared };
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Prepared ${prepared.appId} ${prepared.appVersion} (build ${prepared.buildNumber}).`);
  }
}
