// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeBlack from "starlight-theme-black";

export default defineConfig({
  // Served as a GitHub Pages *project* site (this repo isn't the
  // <user>.github.io root repo), so every internal link/asset needs the
  // /expo-lynx-view prefix baked in at build time.
  site: "https://chanphiromsok.github.io",
  base: "/expo-lynx-view",
  integrations: [
    starlight({
      plugins: [starlightThemeBlack({ docs: { showMarkdownActions: false } })],
      title: "Expo Lynx",
      description:
        "Embed, deliver, and operate signed Lynx mini-app bundles in Expo.",
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
            { label: "Team onboarding", slug: "getting-started/team-onboarding" },
            { label: "Installation", slug: "getting-started/installation" },
            {
              label: "Local development",
              slug: "getting-started/local-development",
            },
          ],
        },
        {
          label: "Managed delivery",
          items: [
            {
              label: "Embedded and remote lifecycle",
              slug: "managed-delivery/lifecycle",
            },
            {
              label: "Local iPhone testing",
              slug: "managed-delivery/local-testing",
            },
            {
              label: "Cloudflare Console setup",
              slug: "managed-delivery/cloudflare-worker",
            },
            {
              label: "Mobile app integration",
              slug: "managed-delivery/host-app-integration",
            },
            {
              label: "Mini-app CLI",
              slug: "managed-delivery/mini-app-integration",
            },
            {
              label: "Worker and Console",
              slug: "managed-delivery/local-console",
            },
            {
              label: "First-render performance",
              slug: "managed-delivery/performance",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "ExpoLynxView", slug: "reference/expo-lynx-view" },
            { label: "Lynx CLI", slug: "reference/cli" },
            { label: "Mobile CLI", slug: "reference/mobile-cli" },
            {
              label: "Local delivery troubleshooting",
              slug: "troubleshooting/local-delivery",
            },
          ],
        },
      ],
    }),
  ],
});
