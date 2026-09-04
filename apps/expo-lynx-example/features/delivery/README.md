# Delivery mini-app

Edit this feature, then run these commands from the repository root:

```sh
# Local Worker and Console
pnpm lynx console

# Expo example app
pnpm start

# Build, package, and upload this feature
pnpm lynx release delivery
```

Open the Console, sign in, select the verified bundle, and enable it. The full
local and Cloudflare deployment guide is
[apps/console/README.md](../../../console/README.md).

For a real device, configure this feature's Expo plugin endpoint as
`https://<worker>.workers.dev/v1/default/delivery`, prebuild and install one
new binary, then follow the **First real-device release** section in that guide.
Changing a remote release later does not need another native build.
