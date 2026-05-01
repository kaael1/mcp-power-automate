import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  applyFlowUpdate,
  cloneFlow,
  createFlow,
  getContextPayload,
  getActiveFlow,
  getCurrentFlow,
  getLastRunSummary,
  getLastUpdateSummary,
  listCapturedTabs,
  previewFlowUpdate,
  getLatestRun,
  getRun,
  getRunActions,
  getTriggerCallbackUrl,
  getStatus,
  invokeTrigger,
  listFlows,
  listRuns,
  refreshFlows,
  revertLastUpdate,
  selectFlow,
  selectWorkTab,
  selectTabFlow,
  setActiveFlow,
  setActiveFlowFromTab,
  updateCurrentFlow,
  validateCurrentFlow,
  waitForRun,
} from './power-automate-client.js';
import {
  addExistingToSolution,
  createEnvironmentVariable,
  createSolution,
  deleteEnvironmentVariable,
  deleteSolution,
  listEnvironmentVariables,
  listSolutionComponents,
  listSolutions,
  publishCustomizations,
  removeFromSolution,
  setEnvVarValue,
} from './dataverse-solutions.js';
import { toErrorPayload } from './errors.js';
import {
  addExistingToSolutionInputSchema,
  cloneFlowInputSchema,
  createEnvironmentVariableInputSchema,
  createFlowInputSchema,
  createSolutionInputSchema,
  deleteEnvironmentVariableInputSchema,
  deleteSolutionInputSchema,
  getRunInputSchema,
  invokeTriggerInputSchema,
  listEnvironmentVariablesInputSchema,
  listFlowsInputSchema,
  listRunsInputSchema,
  listSolutionComponentsInputSchema,
  listSolutionsInputSchema,
  optionalTargetInputSchema,
  publishCustomizationsInputSchema,
  removeFromSolutionInputSchema,
  selectWorkTabInputSchema,
  setActiveFlowInputSchema,
  setEnvVarValueInputSchema,
  triggerCallbackInputSchema,
  updateFlowInputSchema,
  validateFlowInputSchema,
  waitForRunInputSchema,
} from './schemas.js';

const createTextResult = <T>(payload: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload as Record<string, unknown>,
});

const createErrorResult = (error: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(toErrorPayload(error), null, 2) }],
  isError: true,
  structuredContent: {
    error: toErrorPayload(error),
  },
});

const buildHealthPayload = () => {
  return getContextPayload();
};

const createJsonResource = (uri: string, payload: unknown) => ({
  contents: [
    {
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2),
      uri,
    },
  ],
});

export const createMcpApp = () => {
  const server = new McpServer({
    name: 'power-automate-local',
    version: '0.4.1',
  });

  server.registerResource(
    'power-automate-status',
    'power-automate://status',
    {
      description: 'Current active flow status and cached bridge summaries.',
      mimeType: 'application/json',
      title: 'Power Automate Status',
    },
    async () => createJsonResource('power-automate://status', buildHealthPayload()),
  );

  server.registerResource(
    'power-automate-context',
    'power-automate://context',
    {
      description: 'Current Power Automate context, capabilities, and cached summaries.',
      mimeType: 'application/json',
      title: 'Power Automate Context',
    },
    async () => createJsonResource('power-automate://context', getContextPayload()),
  );

  server.registerResource(
    'power-automate-last-run',
    'power-automate://last-run',
    {
      description: 'Last cached run summary for the active flow.',
      mimeType: 'application/json',
      title: 'Power Automate Last Run',
    },
    async () =>
      createJsonResource('power-automate://last-run', {
        lastRun: getLastRunSummary(),
      }),
  );

  server.registerResource(
    'power-automate-active-flow',
    'power-automate://active-flow',
    {
      description: 'Currently selected flow target plus current browser tab flow context.',
      mimeType: 'application/json',
      title: 'Power Automate Active Flow',
    },
    async () =>
      createJsonResource('power-automate://active-flow', {
        activeFlow: await getActiveFlow(),
      }),
  );

  server.registerTool(
    'get_health',
    {
      description: 'Return the current flow status plus cached run and update summaries for troubleshooting.',
    },
    async () => {
      try {
        return createTextResult(buildHealthPayload());
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_context',
    {
      description: 'Return the current Power Automate context, capabilities, and cached run/update summaries.',
    },
    async () => {
      try {
        return createTextResult(getContextPayload());
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'list_flows',
    {
      description: 'List flows from the currently captured environment and optionally filter by name.',
      inputSchema: listFlowsInputSchema,
    },
    async ({ limit, query }) => {
      try {
        return createTextResult(await listFlows({ limit, query }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'refresh_flows',
    {
      description: 'Refresh the flow catalog for the currently captured environment.',
    },
    async () => {
      try {
        return createTextResult(await refreshFlows());
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'list_captured_tabs',
    {
      description: 'List browser tabs whose Power Automate sessions have been captured by the extension.',
    },
    async () => {
      try {
        return createTextResult({
          sessions: listCapturedTabs(),
        });
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'select_work_tab',
    {
      description: 'Select which captured browser tab should drive the MCP work context.',
      inputSchema: selectWorkTabInputSchema,
    },
    async ({ tabId }) => {
      try {
        return createTextResult(await selectWorkTab({ tabId }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'select_flow',
    {
      description: 'Select which flow the MCP should operate on inside the current environment.',
      inputSchema: setActiveFlowInputSchema,
    },
    async ({ flowId }) => {
      try {
        return createTextResult(await selectFlow({ flowId }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'select_tab_flow',
    {
      description: 'Set the active flow target from the currently captured browser tab flow.',
    },
    async () => {
      try {
        return createTextResult(await selectTabFlow());
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'set_active_flow',
    {
      description: 'Select which flow the MCP should operate on inside the current environment.',
      inputSchema: setActiveFlowInputSchema,
    },
    async ({ flowId }) => {
      try {
        return createTextResult(await setActiveFlow({ flowId }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'set_active_flow_from_tab',
    {
      description: 'Set the active flow target from the currently captured browser tab flow.',
    },
    async () => {
      try {
        return createTextResult(await setActiveFlowFromTab());
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_active_flow',
    {
      description: 'Return the selected flow target plus the current browser tab flow context.',
    },
    async () => {
      try {
        return createTextResult(await getActiveFlow());
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'create_flow',
    {
      description: 'Create a new blank flow in the current environment and select it as the active target.',
      inputSchema: createFlowInputSchema,
    },
    async ({ displayName, triggerType }) => {
      try {
        return createTextResult(await createFlow({ displayName, triggerType }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'clone_flow',
    {
      description: 'Clone an existing flow inside the current environment and optionally make the clone the active target.',
      inputSchema: cloneFlowInputSchema,
    },
    async ({ displayName, makeActive, sourceFlowId }) => {
      try {
        return createTextResult(await cloneFlow({ displayName, makeActive, sourceFlowId }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_status',
    {
      description: 'Show whether a Power Automate browser session is captured, which flow is selected, and which flow is open in the current tab.',
    },
    async () => {
      try {
        return createTextResult(getStatus());
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_flow',
    {
      description: 'Fetch the selected Power Automate flow target and return a normalized editable payload.',
      inputSchema: optionalTargetInputSchema,
    },
    async ({ target }) => {
      try {
        return createTextResult(await getCurrentFlow({ target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'preview_flow_update',
    {
      description: 'Preview a flow edit without saving it, returning the proposed review diff and summary.',
      inputSchema: updateFlowInputSchema,
    },
    async ({ displayName, flow, target }) => {
      try {
        return createTextResult(await previewFlowUpdate({ displayName, flow, target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'apply_flow_update',
    {
      description: 'Apply a flow edit and return the saved flow plus the persisted review diff.',
      inputSchema: updateFlowInputSchema,
    },
    async ({ displayName, flow, target }) => {
      try {
        return createTextResult(await applyFlowUpdate({ displayName, flow, target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'update_flow',
    {
      description:
        'Update the selected flow using the normalized flow payload returned by get_flow. The existing environment metadata is preserved automatically.',
      inputSchema: updateFlowInputSchema,
    },
    async ({ displayName, flow, target }) => {
      try {
        return createTextResult(await updateCurrentFlow({ displayName, flow, target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'list_runs',
    {
      description: 'List recent runs for the selected flow target.',
      inputSchema: listRunsInputSchema,
    },
    async ({ limit, target }) => {
      try {
        return createTextResult(await listRuns({ limit, target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_latest_run',
    {
      description: 'Return the most recent run for the selected flow target.',
      inputSchema: optionalTargetInputSchema,
    },
    async ({ target }) => {
      try {
        return createTextResult(await getLatestRun({ target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_trigger_callback_url',
    {
      description: 'Return the callback URL for the selected flow trigger when the trigger supports manual invocation.',
      inputSchema: triggerCallbackInputSchema,
    },
    async ({ target, triggerName }) => {
      try {
        return createTextResult(await getTriggerCallbackUrl({ target, triggerName }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'invoke_trigger',
    {
      description: 'Invoke the selected flow trigger using its callback URL when the trigger supports manual execution.',
      inputSchema: invokeTriggerInputSchema,
    },
    async ({ body, target, triggerName }) => {
      try {
        return createTextResult(await invokeTrigger({ body, target, triggerName }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_run',
    {
      description: 'Return details for a specific run of the selected flow target.',
      inputSchema: getRunInputSchema,
    },
    async ({ runId, target }) => {
      try {
        return createTextResult(await getRun({ runId, target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_run_actions',
    {
      description: 'Return action-level statuses for a specific run of the selected flow target.',
      inputSchema: getRunInputSchema,
    },
    async ({ runId, target }) => {
      try {
        return createTextResult(await getRunActions({ runId, target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'wait_for_run',
    {
      description:
        'Poll the latest run or a specific run until it reaches a terminal status or a timeout is reached.',
      inputSchema: waitForRunInputSchema,
    },
    async ({ pollIntervalSeconds, runId, target, timeoutSeconds }) => {
      try {
        return createTextResult(await waitForRun({ pollIntervalSeconds, runId, target, timeoutSeconds }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_last_update',
    {
      description:
        'Return the last successful flow update recorded by the local bridge, including before/after data, summaries, and a structured review diff.',
    },
    async () => {
      try {
        return createTextResult({
          lastUpdate: getLastUpdateSummary(),
        });
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_last_run',
    {
      description: 'Return the last run summary cached by the local bridge.',
    },
    async () => {
      try {
        return createTextResult({
          lastRun: getLastRunSummary(),
        });
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'revert_last_update',
    {
      description:
        'Revert the selected flow target to the last successfully recorded before-state. The target flow must match the last updated flow.',
      inputSchema: optionalTargetInputSchema,
    },
    async ({ target }) => {
      try {
        return createTextResult(await revertLastUpdate({ target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'validate_flow',
    {
      description:
        'Validate the selected flow definition using the legacy Power Automate validation endpoints when available.',
      inputSchema: validateFlowInputSchema,
    },
    async ({ flow, target }) => {
      try {
        return createTextResult(await validateCurrentFlow({ flow, target }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'list_solutions',
    {
      description:
        'List Power Platform solutions in the current Dataverse environment. Defaults to unmanaged + visible only; pass includeManaged: true to include managed solutions, or query to substring-match friendly names.',
      inputSchema: listSolutionsInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await listSolutions(input || {}));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'create_solution',
    {
      description:
        'Create a new unmanaged Power Platform solution. uniqueName must start with a letter and use only letters/digits/underscores. publisherUniqueName must reference an existing publisher.',
      inputSchema: createSolutionInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await createSolution(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'create_environment_variable',
    {
      description:
        'Create a Solution Environment Variable definition (and optionally an initial value) inside the named solution. schemaName must include a publisher prefix (e.g. "adres_FdHostADREC"). Type "secret" stores values in Azure Key Vault references rather than plain text. On partial failure during a two-step create (definition + value-row): throws ROLLED_BACK (retryable: true; the orphan definition was rolled back so server state matches pre-call) or PARTIAL_FAILURE (retryable: false; rollback also failed — details.orphanDefinitionId is the id for a targeted cleanup via delete_environment_variable).',
      inputSchema: createEnvironmentVariableInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await createEnvironmentVariable(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'set_env_var_value',
    {
      description:
        'Set or update the current value of an existing solution environment variable by schemaName. If no value row exists yet, pass solutionUniqueName to create one in that solution.',
      inputSchema: setEnvVarValueInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await setEnvVarValue(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'add_existing_to_solution',
    {
      description:
        'Add an existing Dataverse component (cloud flow / env var / connection reference / publisher) to a solution. componentType accepts "workflow" | "environmentVariableDefinition" | "environmentVariableValue" | "connectionReference" | "publisher" | "solution" or a numeric Dataverse component-type ID. NOTE: addRequiredComponents defaults to true, which silently pulls the component\'s dependency closure (e.g. connection references for a flow) into the solution. Pass addRequiredComponents: false for a precise add of just the named component.',
      inputSchema: addExistingToSolutionInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await addExistingToSolution(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'list_solution_components',
    {
      description:
        'List components inside a solution. Pass enrich: true to also fetch friendly names for workflows and environment-variable definitions (extra round-trip per component type).',
      inputSchema: listSolutionComponentsInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await listSolutionComponents(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'list_environment_variables',
    {
      description:
        'List environment variable definitions and their current values. Scope to a specific solution by passing solutionUniqueName, otherwise lists every env var in the environment.',
      inputSchema: listEnvironmentVariablesInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await listEnvironmentVariables(input || {}));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'remove_from_solution',
    {
      description:
        'Remove a component from a solution via the Dataverse RemoveSolutionComponent action. Component is not deleted from the environment, only removed from the named solution.',
      inputSchema: removeFromSolutionInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await removeFromSolution(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_solution',
    {
      description:
        'Delete a Power Platform solution by uniqueName. Without force: refuses if the solution still contains any components (so you delete components first). force: true skips the safety check. The Dataverse rows are removed; flows still bound to the solution become unsolutioned (their definitions are not deleted).',
      inputSchema: deleteSolutionInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await deleteSolution(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_environment_variable',
    {
      description:
        'Delete a Solution Environment Variable definition and any associated value rows. Two-step delete (value rows first, then definition) avoids orphaned values that would otherwise persist invisibly in Dataverse.',
      inputSchema: deleteEnvironmentVariableInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await deleteEnvironmentVariable(input));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'publish_customizations',
    {
      description:
        'Publish unpublished customizations in the Dataverse environment. WARNING: this is an ENVIRONMENT-WIDE write — PublishAllXml affects every solution in the env, not just the active one. Pass parameterXml to scope to a specific entity / web-resource set via PublishXml. Required after env-var schema or value changes that need to take effect immediately for already-running consumers.',
      inputSchema: publishCustomizationsInputSchema,
    },
    async (input) => {
      try {
        return createTextResult(await publishCustomizations(input || {}));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  return server;
};
