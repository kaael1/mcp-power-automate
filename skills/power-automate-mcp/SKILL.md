---
name: power-automate-mcp
description: Use when working with Power Automate flows through the v1 local MCP server from this repository. Covers automatic browser-backed connection, reading, validating, editing, running, inspecting, and reverting flows.
---

# Power Automate MCP

Use this skill when the user wants AI help with Microsoft Power Automate flows through the local MCP server and Chromium extension from this repository.

The extension is a passive capture and status surface. Do not ask the user to click extension buttons to make normal MCP work proceed. The AI should operate through MCP tools.

Provider notes live in [references/providers.md](references/providers.md).

## Operating Rules

1. Start with `doctor` or `get_context`.
2. Use `connect_flow` when the target is not already explicit.
3. Prefer browser-captured flows, explicit `flowId`, or a narrow `nameQuery`; if `connect_flow` returns candidates, choose by `flowId` or ask the user which flow is intended.
4. Call `get_flow` before edits.
5. Call `preview_flow_update` before saving.
6. Call `validate_flow` before and after save when available.
7. Call `apply_flow_update` only for the smallest intended change.
8. Call `get_last_update` after save and summarize the review diff.
9. Use `revert_last_update` if the saved result is wrong.
10. Prefer test or staging flows before production flows.

## Recommended Workflows

### Inspection

1. `doctor`
2. `get_context`
3. `connect_flow` if needed
4. `get_flow`
5. `list_runs` or `get_latest_run` if run history matters
6. `get_run_actions` when a run needs action-level triage

### Safe Edit

1. `doctor`
2. `connect_flow`
3. `get_flow`
4. Build the smallest candidate flow change.
5. `preview_flow_update`
6. `validate_flow`
7. `apply_flow_update`
8. `get_last_update`
9. `validate_flow` again when available

### Manual Trigger Test

Use only when the trigger is manual/request based and the payload is safe.

1. `get_flow`
2. `get_trigger_callback_url`
3. `invoke_trigger`
4. `wait_for_run`
5. `get_run`
6. `get_run_actions`

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

## Error Guidance

- `LEGACY_TOKEN_MISSING`: deeper flow-service operations need a compatible browser token. Focus or reopen a real flow page so the extension can capture it automatically.
- `AUTHENTICATION_FAILED`: the captured token was rejected for that endpoint. Reopen or focus the flow page and retry after capture.
- `SCHEMA_VALIDATION_FAILED`: fix the candidate flow JSON. If details include a rejected member such as `retryPolicy`, remove or relocate that field intentionally.
- `CONNECTION_AUTHORIZATION_FAILED`: stop retrying saves. The user must fix the named connector or connection permissions in Power Automate.
- `FLOW_NOT_FOUND`: call `list_flows` and `connect_flow`; browser-captured flows may still be usable even when the live catalog is stale.

## Good Prompts

- "Inspect the connected flow and explain what it does."
- "Connect to the flow whose name contains invoices, then validate it."
- "Preview the smallest change needed, validate it, save it, and show me the review diff."
- "Run a safe test payload through this request-triggered flow and tell me which action failed."

## Production Warning

This MCP can perform real edits. Keep production work supervised, review diffs after save, and use staging flows whenever possible.
