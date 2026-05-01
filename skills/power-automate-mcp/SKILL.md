---
name: power-automate-mcp
description: Use when working with Power Automate flows through the local MCP server from this repository. Covers reading, validating, editing, running, inspecting, and reverting flows through the browser-backed local bridge.
---

# Power Automate MCP

This skill teaches the agent how to operate Power Automate safely through the local MCP server from this repository and its browser extension bridge.

This is a portable `SKILL.md` bundle for agent platforms that support repo-backed or marketplace-backed skills.
The MCP server itself is provider-agnostic.

Provider notes live in [references/providers.md](references/providers.md).

Use this skill when the user wants to:

- inspect a flow
- explain a flow
- modify a flow
- validate a flow
- run a manually triggered flow
- inspect run history or action results
- revert the last saved change

This skill assumes:

- this repository's MCP server is installed in the current client
- the installed server may be labeled differently by the client, but examples below refer to it as `power-automate-local`
- the browser extension from this repo is loaded
- the user is logged into Power Automate in a Chromium browser
- at least one flow from the relevant environment has been opened in the browser so auth and environment context are captured

## Core safety rules

Always follow these rules:

1. Treat the active browser flow as the target flow.
2. Use `list_flows` plus `select_flow` before any meaningful edit or test.
3. Use `get_context` before writes to confirm the selected target flow, selected work tab, current browser tab, and capabilities are not being confused.
4. Do not edit if the user says another person or agent is actively editing the same flow.
5. Prefer minimal changes and validate before and after save.
6. Refresh the browser tab after save when the user needs visual confirmation.
7. If the result is not what was intended, use `revert_last_update`.
8. For high-risk or production flows, prefer working on a disposable or staging flow first.

## Operating model

Important limitations:

- The MCP no longer follows the active tab automatically once a target flow is selected.
- Multiple Power Automate tabs can stay open, but only the selected work tab drives the effective browser-backed session.
- The browser tab still provides auth and current-environment context.
- The agent should explicitly choose a target with `list_flows` and `select_flow`.
- The system depends on browser-backed session and token capture.
- Rollback is currently only one step deep.
- The extension now shows a structured post-save review diff, but it is still not an approval gate before save.
- The best autonomous test path is a flow with a manual HTTP trigger.

## Recommended workflows

### 1. Read-only inspection

Use this when the user asks what the flow does.

Steps:

1. Call `get_context`.
2. If multiple Power Automate tabs are open, call `list_captured_tabs` and `select_work_tab` first.
3. Call `list_flows` if the selected target is unclear.
4. Call `get_flow`.
5. Optionally call `validate_flow`.
6. If runs matter, call `get_latest_run` and `get_run_actions`.

### 2. Safe edit workflow

Use this when the user asks for a flow change.

Steps:

1. Call `get_context`.
2. If multiple Power Automate tabs are open, call `list_captured_tabs` and `select_work_tab` first.
3. Call `list_flows` and `select_flow` unless the target is already explicit and confirmed.
4. Call `get_flow`.
5. Plan the smallest possible change.
6. Call `preview_flow_update`.
7. Call `validate_flow` on the candidate flow before save when possible.
8. Call `apply_flow_update`.
9. Call `get_last_update`.
10. Ask the user to refresh the tab, or review the saved change in the extension `Review` workspace before continuing.
11. If the change looks wrong, call `revert_last_update`.

### 3. Manual trigger test workflow

Use this when the flow has a trigger that supports callback invocation.

Steps:

1. Call `get_flow` and confirm the trigger is manual/request based.
2. If multiple Power Automate tabs are open, call `list_captured_tabs` and `select_work_tab` first.
3. If needed, call `list_flows` and `select_flow` first.
4. Call `get_trigger_callback_url`.
5. Call `invoke_trigger` with a controlled test payload.
6. Call `wait_for_run`.
7. Call `get_run` and `get_run_actions`.
8. Summarize whether the run succeeded and which actions were executed.
9. If the flow response payload matters, report the callback response body too.

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

- `get_context`
- `list_captured_tabs`
- `select_work_tab`
- `get_status`
  Confirms the selected target flow, current tab flow, environment, and whether legacy access is available.

- `get_health`
  Returns a compact troubleshooting payload with current status plus cached run and update summaries.

- `list_flows`
  Lists flows in the current environment and includes an `accessScope` hint such as `owned`, `shared-user`, or `portal-shared`.

- `refresh_flows`
  Refreshes the current environment flow catalog from Power Automate.

- `select_flow`
- `set_active_flow`
  Locks the MCP onto a specific `flowId` in the current environment.

- `select_tab_flow`
- `set_active_flow_from_tab`
  Re-targets the MCP to the flow currently open in the selected work tab.

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

- `preview_flow_update`
  Computes the proposed diff and review summary without saving.

- `apply_flow_update`
  Saves a modified flow definition and returns the persisted review diff.

- `update_flow`
  Compatibility alias for applying a modified flow definition directly.

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

### Solutions and environment variables (Mgabr fork ≥ 0.5.x)

Manage Power Platform solutions and Solution Environment Variables via the
Microsoft Dataverse Web API. Tokens are captured automatically from the
extension's webRequest listener — visit `make.powerapps.com/<env>/solutions`
once and any `*.dynamics.com` page once, then `get_health` should report
`canManageSolutions.available = true`.

- `list_solutions`
  Lists unmanaged + visible solutions in the env. Pass `includeManaged: true`
  to see managed solutions, or `query` to substring-match friendly names.

- `create_solution`
  Creates a new unmanaged solution under an existing publisher. `uniqueName`
  must match `^[A-Za-z][A-Za-z0-9_]*$`.

- `list_solution_components`
  Lists the component graph of a solution. Pass `enrich: true` to also
  resolve friendly names for workflows (cloud flows) and env-var-defs.

- `add_existing_to_solution`
  Adds an existing component to a solution (`workflow`,
  `environmentVariableDefinition`, `environmentVariableValue`,
  `connectionReference`, `publisher`, `solution`, or a numeric Dataverse
  component-type ID).

- `list_environment_variables`
  Returns env-var definitions with their current values (or null where no
  value row exists). Pass `solutionUniqueName` to scope to a solution.

- `create_environment_variable`
  Creates an env-var definition atomically inside the named solution via
  the `MSCRM.SolutionUniqueName` header. `schemaName` must include the
  publisher's customization prefix (e.g. `cr7f66c_FdHostADREC`). When
  `initialValue` is supplied, also creates the value row in the same
  solution.

- `set_env_var_value`
  Upserts the value of an existing env-var. PATCHes when a value row
  exists; POSTs a new value row when none does (in which case
  `solutionUniqueName` is required).

- `remove_from_solution`
  Removes a component from a solution. The component itself remains in
  the environment.

- `delete_solution`
  Deletes a solution by uniqueName. Without `force: true`, refuses if the
  solution still has any components — remove components first.

- `delete_environment_variable`
  Two-step delete: removes any value rows first, then the definition.
  Avoids orphaned values that would confuse later imports.

- `publish_customizations`
  `PublishAllXml` by default; pass `parameterXml` for scoped publishes via
  `PublishXml`. Required after env-var schema changes that need to
  propagate to running flows immediately.

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
2. Confirm the browser extension shows the expected selected target flow and current browser flow.
3. Open the side panel `System` section when you need environment, capture, token, or bridge details.
4. If needed, use `select_work_tab` to choose the correct work tab first, then `select_tab_flow` if you also want the target flow to follow that tab.
5. Refresh the Power Automate tab after reloading the extension.
6. If port `17373` is busy, prefer reusing the healthy bridge instead of starting another manual copy.
7. If the bridge is unhealthy, stop the stale process and start a fresh session.
