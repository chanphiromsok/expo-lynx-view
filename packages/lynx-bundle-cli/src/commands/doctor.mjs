import { Command, Flags } from '@oclif/core';

import { inspectDeliveryWorkspace } from '../doctor.mjs';

export default class Doctor extends Command {
  static description = 'Check local delivery configuration without changing a host, Worker, or release.';
  static examples = [
    'lynx doctor',
    'lynx doctor --remote',
  ];
  static flags = { remote: Flags.boolean({ description: 'also check that the configured Worker is reachable' }), json: Flags.boolean({ description: 'print stable JSON' }), platform: Flags.string({ options: ['ios', 'android'], default: 'ios' }) };

  async run() {
    const { flags } = await this.parse(Doctor);
    const result = await inspectDeliveryWorkspace({ remote: flags.remote, platform: flags.platform });
    if (flags.json) this.log(JSON.stringify(result, null, 2));
    else result.checks.forEach((check) => this.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`));
    if (!result.ok) this.exit(1);
  }
}
