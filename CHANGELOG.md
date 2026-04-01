# Changelog

## 0.3.0

- Migrated the MCP server and Chromium extension source from JavaScript modules to TypeScript.
- Switched the published runtime to `dist/server/index.js` and the unpacked extension runtime to `dist/extension`.
- Added `typecheck`, `lint`, `test`, `build`, and `check` scripts plus a first regression suite for schemas, stores, helpers, and dashboard derivation.
- Rebuilt the extension UI with a React + Tailwind + shadcn-style component stack.
- Added a compact popup plus a richer side panel daily cockpit for makers/operators.
- Added pinned/recent flow support and richer extension-side dashboard state.
- Improved extension resilience around reloads and content-script invalidation.
- Clarified the local-first positioning and the “no Microsoft Entra ID app registration required” onboarding path in the docs.
