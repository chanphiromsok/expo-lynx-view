import { Command, Flags } from '@oclif/core';

import { prepareHostRuntime, registerPreparedHostRuntime } from '../../host-runtime.mjs';

export default class HostPrepare extends Command {
  static description = 'Prepare the embedded host runtime locally; use --register only for CI.';
  static flags = { register: Flags.boolean({ description: 'register the prepared runtime with the Worker' }), json: Flags.boolean({ description: 'print JSON' }) };

  async run() {
    const { flags } = await this.parse(HostPrepare);
    const prepared = await prepareHostRuntime();
    const result = flags.register ? { prepared, registration: await registerPreparedHostRuntime() } : { prepared };
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Prepared ${prepared.appId} ${prepared.appVersion} (build ${prepared.buildNumber}).`);
  }
}
