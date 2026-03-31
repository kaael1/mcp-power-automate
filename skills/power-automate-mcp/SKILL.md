---
name: power-automate-mcp
description: Use when working with Power Automate flows through the local `power-automate-local` MCP server. Covers reading, validating, editing, running, inspecting, and reverting flows through the browser-backed local bridge.
---

# Power Automate MCP

This skill teaches the agent how to operate Power Automate safely through the local `power-automate-local` MCP server and its browser extension bridge.

Use this skill when the user wants to:

- inspect a flow
- explain a flow
- modify a flow
- validate a flow
- run a manually triggered flow
- inspect run history or action results
- revert the last saved change

This skill assumes:

- the MCP server `power-automate-local` is installed in Codex
- the browser extension from this repo is loaded
- the user is logged into Power Automate in a Chromium browser
- at least one flow from the relevant environment has been opened in the browser so auth and environment context are captured

## Core safety rules

Always follow these rules:

1. Treat the active browser flow as the target flow.
2. Use `list_flows` plus `set_active_flow` before any meaningful edit or test.
3. Use `get_status` before writes to confirm the selected target flow and current tab flow are not being confused.
4. Do not edit if the user says another person or agent is actively editing the same flow.
5. Prefer minimal changes and validate before and after save.
6. Refresh the browser tab after save when the user needs visual confirmation.
7. If the result is not what was intended, use `revert_last_update`.
8. For high-risk or production flows, prefer working on a disposable or staging flow first.

## Operating model

Important limitations:

- The MCP no longer follows the active tab automatically once a target flow is selected.
- The browser tab still provides auth and current-environment context.
- The agent should explicitly choose a target with `list_flows` and `set_active_flow`.
- The system depends on browser-backed session and token capture.
- Rollback is currently only one step deep.
- The popup shows a summary, not a full visual diff.
- The best autonomous test path is a flow with a manual HTTP trigger.

## Recommended workflows

### 1. Read-only inspection

Use this when the user asks what the flow does.

Steps:

1. Call `get_status`.
2. Call `list_flows` if the selected target is unclear.
3. Call `get_flow`.
3. Optionally call `validate_flow`.
4. If runs matter, call `get_latest_run` and `get_run_actions`.

### 2. Safe edit workflow

Use this when the user asks for a flow change.

Steps:

1. Call `get_status`.
2. Call `list_flows` and `set_active_flow` unless the target is already explicit and confirmed.
3. Call `get_flow`.
3. Plan the smallest possible change.
4. Call `validate_flow` on the candidate flow before save when possible.
5. Call `update_flow`.
6. Call `get_last_update`.
7. Ask the user to refresh the tab, or instruct them to use the popup `Refresh tab` button.
8. If the change looks wrong, call `revert_last_update`.

### 3. Manual trigger test workflow

Use this when the flow has a trigger that supports callback invocation.

Steps:

1. Call `get_flow` and confirm the trigger is manual/request based.
2. If needed, call `list_flows` and `set_active_flow` first.
2. Call `get_trigger_callback_url`.
3. Call `invoke_trigger` with a controlled test payload.
4. Call `wait_for_run`.
5. Call `get_run` and `get_run_actions`.
6. Summarize whether the run succeeded and which actions were executed.
7. If the flow response payload matters, report the callback response body too.

### 4. Production-ish verification workflow

Use this after a meaningful edit.

Steps:

1. Validate before save.
2. Save.
3. Validate after save.
4. Trigger a test run if the trigger allows it.
5. Inspect the run result.
6. Revert if behavior is wrong.

## Tool quick reference

- `get_status`
  Confirms the selected target flow, current tab flow, environment, and whether legacy access is available.

- `get_health`
  Returns a compact troubleshooting payload with current status plus cached run and update summaries.

- `list_flows`
  Lists flows in the current environment.

- `refresh_flows`
  Refreshes the current environment flow catalog from Power Automate.

- `set_active_flow`
  Locks the MCP onto a specific `flowId` in the current environment.

- `set_active_flow_from_tab`
  Re-targets the MCP to the flow currently open in the captured browser tab.

- `get_active_flow`
  Returns both the selected target flow and the current tab flow.

- `get_flow`
  Returns the normalized payload for the selected target flow.

- `create_flow`
  Creates a blank request or recurrence flow and selects it as the active target.

- `clone_flow`
  Clones an existing flow and can optionally make the clone the active target.

- `validate_flow`
  Uses the legacy flow API to validate the current definition.

- `update_flow`
  Saves a modified flow definition.

- `get_last_update`
  Returns before/after info for the latest save.

- `revert_last_update`
  Reverts to the last saved pre-change state.

- `list_runs`
  Lists recent runs for the active flow.

- `get_latest_run`
  Returns the most recent run summary.

- `get_run`
  Returns a specific run summary.

- `get_run_actions`
  Returns action-level statuses for a run.

- `wait_for_run`
  Polls until a run reaches a terminal state or times out.

- `get_last_run`
  Returns the locally cached latest run summary.

- `get_trigger_callback_url`
  Returns the callback URL for a manual trigger when available.

- `invoke_trigger`
  Triggers a manual/request flow with a test payload.

## Decision guidance

Prefer `invoke_trigger` only when:

- the flow is clearly a manual/request-driven flow
- the payload is controlled
- triggering it will not send emails, approvals, or external mutations the user did not ask for

Avoid autonomous triggering when:

- the flow consumes real production side effects
- the trigger depends on external business events
- the user has not confirmed that test execution is safe

## Good prompts

- "Inspect the current flow and explain it."
- "Add one more action to this test flow, validate it, and refresh my understanding."
- "Run a test payload through this manual flow and tell me which action failed."
- "Revert the last change if the latest run failed."

## Production warning

This MCP is strong enough for supervised real work, but not yet a perfect unattended production operator.

Before using it on critical flows, prefer adding:

- stronger target flow locking
- deeper version history
- richer diffs before save
- stricter confirmation policy for writes

## Troubleshooting

If the MCP looks installed but tools do not appear or the session behaves inconsistently:

1. Check the local bridge health at `http://127.0.0.1:17373/health`.
2. Confirm the browser extension popup shows the expected `Env ID` and `Flow ID`.
3. Confirm the popup `Selected flow` is the one the agent is supposed to operate on.
4. If needed, use `set_active_flow_from_tab` or the popup button to lock the current tab as the target.
5. Refresh the Power Automate tab after reloading the extension.
6. If port `17373` is busy, prefer reusing the healthy bridge instead of starting another manual copy.
7. If the bridge is unhealthy, stop the stale process and start a fresh session.
