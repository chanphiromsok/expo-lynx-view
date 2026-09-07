import { Command, Flags } from '@oclif/core';

import { registerPreparedHostRuntime } from '../../host-runtime.mjs';

export default class HostRegister extends Command {
  static description = 'Register the exact runtime prepared for the current Expo host project.';
  static examples = ['lynx host register'];
  static flags = { json: Flags.boolean({ description: 'print JSON' }), platform: Flags.string({ options: ['ios', 'android'], default: 'ios' }) };

  async run() {
    const { flags } = await this.parse(HostRegister);
    const result = await registerPreparedHostRuntime({ platform: flags.platform });
    this.log(flags.json ? JSON.stringify(result, null, 2) : `Registered ${result.appId} ${result.appVersion} (build ${result.buildNumber}).`);
  }
}
