import ConsoleSetup from './commands/console/setup.mjs';
import ConsoleDeploy from './commands/console/deploy.mjs';
import Console from './commands/console/index.mjs';
import Doctor from './commands/doctor.mjs';
import Host from './commands/host.mjs';
import Keys from './commands/keys/index.mjs';
import Release from './commands/release/index.mjs';

export default {
  'console:setup': ConsoleSetup,
  'console:deploy': ConsoleDeploy,
  console: Console,
  doctor: Doctor,
  host: Host,
  keys: Keys,
  release: Release,
};
