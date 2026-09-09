// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { ion } from "starlight-ion-theme";

export default defineConfig({
  integrations: [
    starlight({
      // plugins: [ion()],
      title: "Expo Lynx",
      description:
        "Embed, deliver, and operate signed Lynx mini-app bundles in Expo.",
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "" },
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
          ],
        },
        {
          label: "Reference",
          items: [
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
