# Changelog

## Unreleased

## 1.0.0

- Replaced the MCP tool registration with a v1 command registry shared by MCP tools and `/v1/commands/:name` bridge routes.
- Added `doctor` and `connect_flow` as the primary readiness and targeting commands.
- Removed compatibility aliases from the public MCP tool surface.
- Made reused MCP instances proxy command execution to the bridge owner instead of keeping divergent local state.
- Expanded bridge health with identity, version, PID, port, startup time, and blocked capability reason.
- Made browser-captured flows part of catalog fallback so stale local catalogs do not block target connection.
- Changed the extension into an automatic capture/status surface without operational sync or refresh buttons.
- Added CLI helpers: `doctor`, `extension-path`, and `version`.
- Updated README and skill guidance for the v1 npm-first install and automatic browser-backed workflow.

## 0.4.1

- Simplified the public README visuals so the main SVG banner reads cleanly on GitHub without clipped or crowded text.
- Removed the secondary architecture image from the README and tightened the visual hierarchy around the main banner.
- Prepared a clean patch release after the `v0.4.0` tag so GitHub, npm, and the MCP Registry can be re-aligned on the latest public state.

## 0.4.0

- Refined the extension UI around a compact popup quick launcher and a clearer side-panel workspace with `Today`, `Flows`, `Review`, and `System`.
- Moved the full saved-change diff into a dedicated review workspace and hid low-level diagnostics behind the system area by default.
- Added locale-aware workspace controls plus render-focused tests for popup, review, system, and recovery states.
- Tightened the button, input, card, and status styling toward a cleaner utilitarian visual language.
- Updated the README and bundled skill guidance to match the new workspace structure and troubleshooting flow.

## 0.3.0

- Migrated the MCP server and Chromium extension source from JavaScript modules to TypeScript.
- Switched the published runtime to `dist/server/index.js` and the unpacked extension runtime to `dist/extension`.
- Added `typecheck`, `lint`, `test`, `build`, and `check` scripts plus a first regression suite for schemas, stores, helpers, and dashboard derivation.
- Rebuilt the extension UI with a React + Tailwind + shadcn-style component stack.
- Added a compact popup plus a richer side panel daily cockpit for makers/operators.
- Added pinned/recent flow support and richer extension-side dashboard state.
- Improved extension resilience around reloads and content-script invalidation.
- Clarified the local-first positioning and the “no Microsoft Entra ID app registration required” onboarding path in the docs.
