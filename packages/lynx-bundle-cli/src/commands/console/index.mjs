import { Args, Command, Flags } from '@oclif/core';

import { deployConsole } from '../../console-setup.mjs';
import { runConsoleSetup } from './setup.mjs';

export default class Console extends Command {
  static description = 'Create or deploy the Cloudflare delivery Console and Worker.';

  static examples = [
    'lynx console setup --username phirom',
    'lynx console deploy',
  ];

  static args = { action: Args.string({ description: 'setup or deploy the Console', options: ['setup', 'deploy'], required: true }) };
  static flags = {
    'account-id': Flags.string({ env: 'CLOUDFLARE_ACCOUNT_ID' }),
    'r2-access-key-id': Flags.string({ env: 'R2_ACCESS_KEY_ID' }),
    'r2-secret-access-key': Flags.string({ env: 'R2_SECRET_ACCESS_KEY' }),
    'signing-private-key-path': Flags.file(),
    username: Flags.string(),
    'dry-run': Flags.boolean(),
  };

  async run() {
    const { args, flags } = await this.parse(Console);
    if (args.action === 'deploy') return deployConsole();
    if (!flags.username) throw new Error('console setup requires --username.');
    await runConsoleSetup(flags);
  }
}
