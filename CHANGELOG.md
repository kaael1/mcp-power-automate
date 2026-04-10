# Changelog

## Unreleased

- Made the bundled `power-automate-mcp` skill more provider-neutral so the same `SKILL.md` bundle can be reused across Codex, LobeHub, and other skill-capable clients.
- Added multi-provider distribution guidance covering one canonical skill bundle, thin provider adapters, and local-first marketplace positioning.

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
