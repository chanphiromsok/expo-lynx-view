import { Command, Flags } from '@oclif/core';

import { registerPreparedHostRuntime } from '../../host-runtime.mjs';

export default class HostRegister extends Command {
  static description = 'Register the exact runtime prepared for the current Expo host project.';
  static flags = { json: Flags.boolean({ description: 'print JSON' }) };

  async run() {
    const { flags } = await this.parse(HostRegister);
    const result = await registerPreparedHostRuntime();
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Registered ${result.appId} ${result.appVersion} (build ${result.buildNumber}).`);
  }
}
