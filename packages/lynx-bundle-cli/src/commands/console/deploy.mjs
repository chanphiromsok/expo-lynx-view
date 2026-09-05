import { Command } from '@oclif/core';

import { deployConsole } from '../../console-setup.mjs';

export default class ConsoleDeploy extends Command {
  static description = 'Deploy the Console Worker and apply pending D1 migrations without replacing data or secrets.';

  async run() {
    await this.parse(ConsoleDeploy);
    deployConsole();
  }
}
