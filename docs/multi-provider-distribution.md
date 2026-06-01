# Multi-Provider Distribution

This repo should ship one MCP implementation, one Chromium extension, one public visual story, and one canonical skill bundle, then reuse them across multiple providers.

## Source-of-truth model

Keep these layers separate:

1. MCP runtime
   Files: `server/`, `extension/`, `dist/`, `server.json`, `package.json`
   Purpose: the actual local Power Automate MCP server and browser-backed bridge.
2. Visual and README story
   Files: `README.md`, `assets/readme-cover.png`, `docs/launch-kit.md`
   Purpose: the public promise, install flow, and launch-ready social proof.
3. Skill bundle
   Files: `skills/power-automate-mcp/`
   Purpose: reusable `SKILL.md` guidance for agents that support skills.
4. Provider adapters
   Files: marketplace listings, install snippets, provider docs
   Purpose: provider-specific packaging and discovery, without changing the underlying workflow.

## Canonical artifacts

- npm package: `@kaael1/mcp-power-automate`
- MCP registry name: `io.github.kaael1/mcp-power-automate`
- canonical skill folder: `skills/power-automate-mcp/`
- README cover image: `assets/readme-cover.png`
- example local server label: `power-automate-local`

## Distribution surfaces

### MCP surfaces

- npm package for direct local install
- Official MCP Registry for broad MCP discovery
- provider-specific MCP marketplaces such as LobeHub

### Skill surfaces

- GitHub-backed skill install flows such as `npx skills add`
- provider skill marketplaces such as LobeHub Skills
- direct local install into agent-specific skill folders

## Adapter strategy

When adding a new provider:

1. Reuse the same MCP package and `server.json`.
2. Reuse the same `skills/power-automate-mcp/` folder whenever the provider can consume a `SKILL.md` bundle.
3. Reuse the README positioning and `docs/launch-kit.md` copy before writing provider-specific variants.
4. Use `assets/readme-cover.png` as the default visual unless the provider requires a different aspect ratio.
5. Add only the minimum provider-specific metadata or submission copy required by that provider.
6. Keep provider-only instructions out of the core workflow unless the platform behavior truly differs.

## LobeHub-specific guidance

For LobeHub, treat the project as two related listings:

- MCP listing: the local MCP server package and its registry metadata
- Skill listing: the `skills/power-automate-mcp/` bundle

Because this project depends on a local browser session, browser extension, and local bridge, position it as a local or local-first service rather than a hosted SaaS integration.

## Release checklist

1. Keep `package.json`, `server.json`, and `CHANGELOG.md` aligned on version.
2. Run `bun run check`.
3. Run `npm pack --dry-run` and confirm the `skills/` folder is included.
4. Confirm `assets/readme-cover.png` is included in the package asset list.
5. Publish npm.
6. Publish or refresh the Official MCP Registry entry.
7. Refresh any skill surfaces that package `skills/power-automate-mcp/`.
8. Refresh provider marketplace listings that mirror the MCP or skill metadata.
9. Refresh launch traction numbers in `docs/launch-kit.md` only when they are being reused publicly.

## Maintenance rules

- Treat `skills/power-automate-mcp/SKILL.md` as the canonical operating guidance.
- Treat provider docs and marketplace copy as adapters, not forks.
- Treat launch traction as dated copy. Do not let changing star counts become required runtime docs.
- If a new provider needs wrapper files, keep them thin and point back to the same core instructions.
- Avoid provider-specific naming in the core skill unless it is essential to tool behavior.
