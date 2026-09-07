import ConsoleSetup from './commands/console/setup.mjs';
import ConsoleDeploy from './commands/console/deploy.mjs';
import Console from './commands/console/index.mjs';
import Doctor from './commands/doctor.mjs';
import Host from './commands/host/index.mjs';
import HostPrepare from './commands/host/prepare.mjs';
import HostRegister from './commands/host/register.mjs';
import HostEmbed from './commands/host/embed.mjs';
import Keys from './commands/keys/index.mjs';
import Release from './commands/release/index.mjs';
import ReleaseUpload from './commands/release/upload.mjs';

export default {
  'console:setup': ConsoleSetup,
  'console:deploy': ConsoleDeploy,
  console: Console,
  doctor: Doctor,
  host: Host,
  'host:embed': HostEmbed,
  keys: Keys,
  'host:prepare': HostPrepare,
  'host:register': HostRegister,
  release: Release,
  'release:upload': ReleaseUpload,
};
