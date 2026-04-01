<p align="center">
  <img src="./assets/readme-banner.svg" alt="MCP Power Automate banner" width="100%" />
</p>

# MCP Power Automate

<p align="center">
  <a href="https://github.com/kaael1/mcp-power-automate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/kaael1/mcp-power-automate?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@kaael1/mcp-power-automate"><img alt="npm version" src="https://img.shields.io/npm/v/%40kaael1%2Fmcp-power-automate?style=flat-square" /></a>
  <a href="https://github.com/kaael1/mcp-power-automate/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-0f172a?style=flat-square" /></a>
  <a href="https://skills.sh/"><img alt="skills.sh compatible" src="https://img.shields.io/badge/skills.sh-compatible-111827?style=flat-square" /></a>
  <a href="https://registry.modelcontextprotocol.io/v0/servers?search=io.github.kaael1/mcp-power-automate"><img alt="Official MCP Registry" src="https://img.shields.io/badge/MCP%20Registry-published-2563eb?style=flat-square" /></a>
</p>

Local MCP server, Chromium extension, and optional Codex skill for operating Microsoft Power Automate flows from a local browser-backed session.

> No Microsoft Entra ID app registration, admin consent, or custom enterprise app setup is required.
> This MCP uses your existing logged-in browser session instead, which is often much easier to adopt inside locked-down companies.

This project lets an agent:

- list flows from the current environment, including owned and shared-visible flows
- select an explicit target flow instead of following the active tab
- read, validate, update, create, clone, test, inspect runs, and revert flows
- use the browser only for auth and visual context while the MCP owns the workflow logic

The server is MCP-client agnostic.

- Use the MCP from Codex, Claude clients, Gemini clients, OpenCode, or any other MCP client that supports local `stdio` servers.
- The bundled `power-automate-mcp` skill in this repository is Codex-specific helper guidance, not a requirement for the MCP itself.

## Install in 60 seconds

Install the optional Codex skill from GitHub:

```bash
npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

Register the MCP locally:

```powershell
codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate
```

Load the extension:

1. Open `chrome://extensions` or `edge://extensions`
2. Enable Developer Mode
3. If you are working from a clone, run `bun install` and `bun run build`
4. Click `Load unpacked`
5. Select the `dist/extension` folder

Open Power Automate, refresh any flow page, and ask your MCP client to:

1. `list_flows`
2. `set_active_flow`
3. `get_flow`

If this saves you time, star the repo:

- https://github.com/kaael1/mcp-power-automate

## Public package and registry links

- GitHub: https://github.com/kaael1/mcp-power-automate
- npm: https://www.npmjs.com/package/@kaael1/mcp-power-automate
- Official MCP Registry: https://registry.modelcontextprotocol.io/v0/servers?search=io.github.kaael1/mcp-power-automate
- skills.sh discovery: https://skills.sh/

## How it works

<p align="center">
  <img src="./assets/architecture.svg" alt="Architecture overview for MCP Power Automate" width="100%" />
</p>

The project has three pieces:

- `server/`
  TypeScript source for the local MCP server plus an HTTP bridge on `127.0.0.1:17373`
- `extension/`
  TypeScript source for the Chromium extension that captures browser auth, tab flow context, token audit, and snapshots
- `dist/`
  Compiled runtime artifacts used for local loading and npm publishing
- `skills/power-automate-mcp/`
  Optional Codex-specific skill instructions that teach the agent to work safely with explicit flow targeting

## Why this is local

This project is intentionally local-first.

- Your browser session remains the auth source
- You do not need to provision a Microsoft Entra ID app just to use the MCP
- The extension captures the environment and tab context you already trust
- The MCP runs on your machine and talks to Power Automate with your browser-backed session
- The selected target flow is explicit, so the agent does not blindly follow whichever tab is active

This gives you a good tradeoff:

- much more agent autonomy than manual clicking
- much less infrastructure and auth complexity than a remote SaaS MCP

## Current capabilities

- Read the selected target flow
- List flows from the current environment
- Merge `owned`, `shared-user`, and `portal-shared` flows into one catalog
- Lock the MCP onto an explicit active target flow
- Validate flows with legacy validation endpoints
- Update a flow and keep one-step rollback history
- Create a blank request or recurrence flow
- Clone an existing flow
- List runs, inspect action-level results, and wait for completion
- Get a callback URL and invoke manual/request flows

## Install options

### 1. Skill install from GitHub

```bash
npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

You can verify discovery with:

```bash
npx skills add kaael1/mcp-power-automate --list
```

### 2. MCP install from npm

Use this in Codex-compatible config:

```json
{
  "mcpServers": {
    "power-automate-local": {
      "command": "npx",
      "args": ["-y", "@kaael1/mcp-power-automate"]
    }
  }
}
```

### 3. MCP install from local clone

```powershell
bun install
bun run build
codex mcp add power-automate-local -- node /path/to/mcp-power-automate/dist/server/index.js
```

## Development checks

```bash
bun run typecheck
bun run lint
bun run test
bun run build
bun run check
```

## Typical workflow

1. Start the local bridge and MCP.
2. Open any flow in the target Power Automate environment.
3. Let the extension capture auth and environment context.
4. Ask Codex to `list_flows`.
5. Ask Codex to `set_active_flow` for the flow you actually want.
6. Continue with `get_flow`, `validate_flow`, `update_flow`, `list_runs`, `get_run`, `wait_for_run`, or `invoke_trigger`.

The popup and side panel help you:

- compare the selected target flow with the current tab flow
- switch the selected target to the current tab
- refresh run status
- review the last update summary
- revert the last saved change
- browse pinned, recent, and current-environment flows from a daily cockpit view

`list_flows` returns an `accessScope` hint per flow:

- `owned`
- `shared-user`
- `portal-shared`

## Available MCP tools

- `get_status`
- `get_health`
- `list_flows`
- `refresh_flows`
- `set_active_flow`
- `set_active_flow_from_tab`
- `get_active_flow`
- `get_flow`
- `update_flow`
- `create_flow`
- `clone_flow`
- `validate_flow`
- `get_last_update`
- `revert_last_update`
- `list_runs`
- `get_latest_run`
- `get_run`
- `get_run_actions`
- `wait_for_run`
- `get_last_run`
- `get_trigger_callback_url`
- `invoke_trigger`

## Available resources

- `power-automate://status`
- `power-automate://last-run`
- `power-automate://active-flow`

## Security model

This MCP is not a remote cloud service.

- It depends on a logged-in Chromium session
- It uses browser-backed tokens captured locally by the extension
- It is best suited for trusted local use
- It is strong enough for supervised real work, but still benefits from change discipline on production flows

## Current limitations

- The browser still provides auth and current-tab context
- Rollback is currently one step only
- The extension focuses on operational context and safe actions, not a full diff editor
- The current architecture is local-first, not remote SaaS-style
- Critical production use is still best done with supervision

## Publishing

This repo is already prepared for:

- GitHub discovery
- `skills.sh` / Vercel-style skill installation
- npm distribution
- Official MCP Registry publishing

Relevant files:

- [`package.json`](package.json)
- [`server.json`](server.json)
- [`PUBLISHING.md`](PUBLISHING.md)
- [`CHANGELOG.md`](CHANGELOG.md)

## Client compatibility

The MCP server itself is designed around standard local `stdio` transport, so it is not tied to Codex.

- Codex: supported directly, and the bundled skill is written for Codex.
- Claude clients with MCP support: should work with the MCP server directly.
- Gemini clients with MCP support: should work with the MCP server directly.
- Other MCP clients such as OpenCode: should work as long as they support local `stdio` MCP servers.

What is client-specific:

- the `skills/power-automate-mcp` skill is Codex-oriented guidance
- the browser extension UX is generic, but any prompt helpers or slash-command conventions depend on the client

The safe rule of thumb is:

- if the client can launch a local `stdio` MCP server, it can use this MCP server
- if the client understands Codex skills, it can also use the bundled skill directly

## Repo guidance

See [`AGENTS.md`](AGENTS.md) for local repository guidance for agents and contributors.

## License

MIT. See [`LICENSE`](LICENSE).
