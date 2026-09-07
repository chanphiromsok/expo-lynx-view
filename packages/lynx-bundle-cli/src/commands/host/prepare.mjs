import { Command, Flags } from '@oclif/core';

import { prepareHostRuntime, registerPreparedHostRuntime } from '../../host-runtime.mjs';

export default class HostPrepare extends Command {
  static description = 'Prepare the embedded host runtime locally; use --register only for CI.';
  static examples = ['lynx host prepare', 'lynx host prepare --register'];
  static flags = { register: Flags.boolean({ description: 'register the prepared runtime with the Worker' }), json: Flags.boolean({ description: 'print JSON' }), platform: Flags.string({ options: ['ios', 'android'], default: 'ios' }) };

  async run() {
    const { flags } = await this.parse(HostPrepare);
    const prepared = await prepareHostRuntime({ platform: flags.platform });
    const result = flags.register ? { prepared, registration: await registerPreparedHostRuntime({ platform: flags.platform }) } : { prepared };
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Prepared ${prepared.appId} ${prepared.appVersion} (build ${prepared.buildNumber}).`);
  }
}
