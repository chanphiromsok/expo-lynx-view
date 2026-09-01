## Rspeedy project

This is a ReactLynx project bootstrapped with `create-rspeedy`.

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

Then, run the development server:

```bash
pnpm run dev
```

Scan the QRCode in the terminal with your LynxExplorer App to see the result.

You can start editing the page by modifying `src/App.tsx`. The page auto-updates as you edit the file.

at root: pnpm lynx release delivery after make change
console: pnpm exec wrangler dev \
  --local \
  --persist-to .wrangler/delivery-worker-v2 \
  --ip 0.0.0.0 \
  --port 8787 \
  --var LOCAL_UPLOADS:true

expo-lynx-example:  pnpm run start