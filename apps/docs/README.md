# Expo Lynx documentation

This is the MDX documentation website for the Expo Lynx monorepo. It is built
with Astro Starlight and is the canonical developer-facing explanation of the
managed bundle lifecycle, local delivery workflow, CLI, and troubleshooting.

## Authoring

Add or edit `.md` and `.mdx` pages in:

```text
src/content/docs/
```

Every page has frontmatter with a title and description. Keep package READMEs
short and link to the relevant page here instead of duplicating operational
instructions in several locations.

## Commands

Run from the monorepo root:

```sh
pnpm docs
pnpm docs:build
```

`pnpm docs` starts the local Starlight development server. `pnpm docs:build`
creates the static production site in `apps/docs/dist`.

The site is intentionally static. It can later be deployed to Cloudflare
Workers without a database or server-rendering layer.
