import { Args, Command, Flags } from '@oclif/core';

import { deployConsole } from '../../console-setup.mjs';
import { loadNearestDeliveryEnvironment } from '../../env.mjs';
import { runConsoleSetup } from './setup.mjs';

export default class Console extends Command {
  static description = 'Create or deploy the Cloudflare delivery Console and Worker.';

  static examples = [
    'lynx console setup',
    'lynx console deploy',
  ];

  static args = { action: Args.string({ description: 'setup or deploy the Console', options: ['setup', 'deploy'], required: true }) };
  static flags = {
    'dry-run': Flags.boolean(),
  };

  async run() {
    const { args, flags } = await this.parse(Console);
    if (args.action === 'deploy') return deployConsole({ environmentPath: loadNearestDeliveryEnvironment() });
    await runConsoleSetup(flags);
  }
}
