# AGENTS.md

This repository contains a local MCP server, a Chromium extension, and a Codex skill for operating Power Automate flows.

## Goals

- Keep the MCP and the skill aligned
- Prefer safe, supervised automation over opaque convenience
- Make flow changes observable, reversible, and testable

## Working rules

1. Do not make destructive flow changes by default.
2. Prefer editing test or staging flows before production flows.
3. Before changing a flow, inspect it with `get_status` and `get_flow`.
4. Validate before and after save when possible.
5. Keep changes minimal and easy to revert.
6. Preserve the browser-backed workflow:
   the extension provides the live target flow and session context.
7. When changing the server, keep the popup and skill instructions in sync.
8. Runtime-generated files in `data/` are local state and must not be committed.

## Repository map

- `server/`: MCP server, HTTP bridge, local persistence
- `extension/`: browser extension for capture, status, and light controls
- `skills/power-automate-mcp/`: reusable skill instructions for Codex
- `data/`: runtime state only

## Local Codex registration

When working from this checkout, prefer registering Codex against the local built server instead of the published `npx` package so local fixes are exercised:

```powershell
npm run build
$nodePath = (Get-Command node).Source
$serverPath = Join-Path (Get-Location) "dist/server/index.js"
codex mcp add power-automate-local -- $nodePath $serverPath
```

If an older `power-automate-local` entry already exists, remove it first with:

```powershell
codex mcp remove power-automate-local
```

Load the browser extension from `dist/extension` after rebuilding. If the popup says the bridge is offline while `http://127.0.0.1:17373/health` works, check for a version mismatch between the extension bundle and the running bridge.

## Publishing guidance

- Keep the skill in this same repository unless there is a strong reason to split release cycles.
- If you add or rename MCP tools, update:
  - `skills/power-automate-mcp/SKILL.md`
  - `README.md`
  - popup wording if user-facing behavior changes
