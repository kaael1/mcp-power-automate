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

## Solutions and Environment Variables (fork additions, 0.5.x)

The fork extends the MCP with Power Platform Solutions and Solution
Environment Variable management. These tools talk to the Microsoft
Dataverse Web API at `{instanceApiUrl}/api/data/v9.2/` and require the
extension to capture two new audience tokens automatically:

- BAP / `service.powerapps.com` audience — minted when the user visits
  `make.powerapps.com/<env>/...`.
- Dataverse audience (`https://<org>.crm<N>.dynamics.com/`) — minted
  when the user visits any URL on the Dataverse host (Power Apps Studio,
  model-driven app, customizations panel).

The extension's auxiliary webRequest listener on
`https://api.bap.microsoft.com/*` and `https://*.dynamics.com/*` decodes
each request's Authorization JWT and posts a single-candidate audit to
`/token-audit`. The server's `/token-audit` POST handler MERGES new
candidates into the audit (deduped by token, newest 50 retained) so
single-candidate auxiliary POSTs accumulate alongside full storage scans.

Implementation notes:

- Solution and env-var operations always use the non-admin BAP path
  `/providers/Microsoft.BusinessAppPlatform/environments/{envId}` since
  the `/scopes/admin/` variant requires Power Platform tenant admin.
- New env-var definitions and their value rows are placed in a solution
  via the `MSCRM.SolutionUniqueName` header on the POST, atomically.
- `set_env_var_value` upserts: PATCHes the existing value row when one
  exists, otherwise requires `solutionUniqueName` so it can POST a new
  value row in that solution.
- Component-type aliases (`workflow=29`, `environmentVariableDefinition=380`,
  `environmentVariableValue=381`, `connectionReference=10112`, `publisher=59`,
  `solution=7600`) live in `dataverse-solutions.ts` and may need to be
  extended as new Dataverse component types are needed.

## Publishing guidance

- Keep the skill in this same repository unless there is a strong reason to split release cycles.
- If you add or rename MCP tools, update:
  - `skills/power-automate-mcp/SKILL.md`
  - `README.md`
  - popup wording if user-facing behavior changes
