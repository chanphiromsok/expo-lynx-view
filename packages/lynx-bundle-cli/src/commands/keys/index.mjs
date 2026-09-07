import { Args, Command, Flags } from '@oclif/core';

import { generateSigningKeyPair } from '../../signing-keys.mjs';

export default class Keys extends Command {
  static description = 'Create the RSA trust key pair once in the Expo host repository.';

  static examples = [
    'lynx keys generate',
    'lynx keys generate --public-key-path ./keys/lynx/updates.public.pem',
  ];

  static args = { action: Args.string({ description: 'generate a signing key pair', options: ['generate'], required: true }) };
  static flags = {
    'public-key-path': Flags.file(),
    'private-key-path': Flags.file({ default: '.local-lynx-keys/updates.private.pem' }),
    json: Flags.boolean(),
  };

  async run() {
    const { flags } = await this.parse(Keys);
    const result = generateSigningKeyPair({
      publicKeyPath: flags['public-key-path'],
      privateKeyPath: flags['private-key-path'],
    });
    if (flags.json) return this.log(JSON.stringify(result, null, 2));
    const message = result.status === 'restored-public-key'
      ? `Restored mobile public key: ${result.publicKeyPath}\nExisting Worker private key: ${result.privateKeyPath}`
      : `Created mobile public key: ${result.publicKeyPath}\nCreated Worker private key: ${result.privateKeyPath}`;
    this.log(message);
  }
}
