<p align="center">
  <img src="./assets/readme-banner.svg" alt="MCP Power Automate banner" width="100%" />
</p>

# MCP Power Automate

Local MCP server and Chromium extension for AI-operated Microsoft Power Automate flows.

The extension captures the browser session, current flow, snapshots, and token candidates automatically. The MCP server exposes one clean v1 tool surface so the AI can inspect, edit, validate, run, review, and revert flows without asking the user to click extension buttons just to make the connection work.

> No Microsoft Entra ID app registration, admin consent, or custom enterprise app setup is required.
> The MCP uses your existing logged-in Chromium session.

## What v1 Changes

- One command registry powers both MCP tools and HTTP bridge routes.
- The local bridge is authoritative; reused MCP instances proxy commands to the bridge owner.
- Flow targeting is automatic-first through captured tabs, explicit `connect_flow`, catalog data, and snapshots.
- The extension is status and diagnostics only. It no longer requires manual refresh/sync buttons for normal operation.
- npm ships the built server and built extension together.

## Install

Register the MCP:

```powershell
codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate
```

Find the packaged extension path:

```powershell
npx -y @kaael1/mcp-power-automate extension-path
```

Load that folder in Chromium:

1. Open `chrome://extensions` or `edge://extensions`
2. Enable Developer Mode
3. Choose `Load unpacked`
4. Select the path printed by `extension-path`

Open or focus any Power Automate flow page. The extension captures the context automatically.

Check readiness:

```powershell
npx -y @kaael1/mcp-power-automate doctor
```

## Recommended AI Workflow

Ask your MCP client to:

1. `doctor`
2. `get_context`
3. `connect_flow`
4. `get_flow`
5. `preview_flow_update`
6. `validate_flow`
7. `apply_flow_update`
8. `get_last_update`

For run inspection and manual/request trigger tests, use `list_runs`, `get_latest_run`, `get_run`, `get_run_actions`, `wait_for_run`, `get_trigger_callback_url`, and `invoke_trigger`.

## Public v1 Tools

- `get_context`
- `doctor`
- `connect_flow`
- `list_flows`
- `get_flow`
- `preview_flow_update`
- `validate_flow`
- `apply_flow_update`
- `get_last_update`
- `revert_last_update`
- `list_runs`
- `get_latest_run`
- `get_run`
- `get_run_actions`
- `wait_for_run`
- `get_trigger_callback_url`
- `invoke_trigger`
- `create_flow`
- `clone_flow`

## HTTP Bridge

The bridge listens on `127.0.0.1:17373`.

- `GET /health` is kept for simple probes.
- `GET /v1/health` returns bridge identity and readiness.
- `GET /v1/context` returns the same context used by the MCP.
- `GET /v1/commands` lists the public v1 command surface.
- `POST /v1/commands/:name` runs any public v1 command with a JSON body.

Only the process that owns the bridge port executes stateful work. Other MCP instances reuse the healthy bridge and proxy commands to it.

## Safety Model

- Use `preview_flow_update` before saves.
- Use `validate_flow` before and after meaningful edits when available.
- Use `get_last_update` to review the persisted diff.
- Use `revert_last_update` if the saved result is wrong.
- Prefer test or staging flows before production flows.

If Power Automate rejects a save because of a connection permission problem, the MCP reports `CONNECTION_AUTHORIZATION_FAILED` and waits for the user to fix that connection in Power Automate. If the service rejects a field such as `retryPolicy`, the MCP reports `SCHEMA_VALIDATION_FAILED` with the rejected member so the AI can correct the candidate flow instead of guessing.

## Development

```powershell
npm install
npm run typecheck
npm run lint
npm run test
npm run build
npm run pack:dry-run
```

For a local clone:

```powershell
npm run build
codex mcp add power-automate-local -- node C:\path\to\mcp-power-automate\dist\server\index.js
node C:\path\to\mcp-power-automate\dist\server\index.js extension-path
```

Runtime state lives in `data/` and must not be committed.

## Package Links

- GitHub: https://github.com/kaael1/mcp-power-automate
- npm: https://www.npmjs.com/package/@kaael1/mcp-power-automate
- MCP Registry: https://registry.modelcontextprotocol.io/v0/servers?search=io.github.kaael1/mcp-power-automate

## License

MIT. See [`LICENSE`](LICENSE).
