import { fileURLToPath } from "node:url";

import { pluginReactLynx } from "@lynx-js/react-rsbuild-plugin";
import { defineConfig } from "@lynx-js/rspeedy";

// The <FastImage> wrapper is vendored under src/lib/lynx-fast-image/ (the
// sibling lynx-fast-image repo is not part of this monorepo). Alias the bare
// specifier so the ported demo screens keep `import ... from "lynx-fast-image"`.
const fastImage = fileURLToPath(
  new URL("./src/lib/lynx-fast-image/index.ts", import.meta.url),
);

export default defineConfig({
  source: {
    entry: { main: "./src/index.tsx" },
  },
  plugins: [pluginReactLynx()],
  resolve: {
    alias: {
      "lynx-fast-image": fastImage,
    },
  },
});
