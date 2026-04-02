import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  cloneFlow,
  createFlow,
  getActiveFlow,
  getCurrentFlow,
  getLastRunSummary,
  getLastUpdateSummary,
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
  setActiveFlow,
  setActiveFlowFromTab,
  updateCurrentFlow,
  validateCurrentFlow,
  waitForRun,
} from './power-automate-client.js';
import {
  cloneFlowInputSchema,
  createFlowInputSchema,
  getRunInputSchema,
  invokeTriggerInputSchema,
  listFlowsInputSchema,
  listRunsInputSchema,
  setActiveFlowInputSchema,
  triggerCallbackInputSchema,
  updateFlowInputSchema,
  validateFlowInputSchema,
  waitForRunInputSchema,
} from './schemas.js';

const createTextResult = <T>(payload: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload,
});

const createErrorResult = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

const buildHealthPayload = () => {
  const status = getStatus();

  return {
    activeFlow: status.activeTarget || null,
    lastRun: getLastRunSummary(),
    lastUpdate: getLastUpdateSummary(),
    status,
  };
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
    },
    async () => {
      try {
        return createTextResult(await getCurrentFlow());
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
    async ({ displayName, flow }) => {
      try {
        return createTextResult(await updateCurrentFlow({ displayName, flow }));
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
    async ({ limit }) => {
      try {
        return createTextResult(await listRuns({ limit }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_latest_run',
    {
      description: 'Return the most recent run for the selected flow target.',
    },
    async () => {
      try {
        return createTextResult(await getLatestRun());
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
    async ({ triggerName }) => {
      try {
        return createTextResult(await getTriggerCallbackUrl({ triggerName }));
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
    async ({ body, triggerName }) => {
      try {
        return createTextResult(await invokeTrigger({ body, triggerName }));
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
    async ({ runId }) => {
      try {
        return createTextResult(await getRun({ runId }));
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
    async ({ runId }) => {
      try {
        return createTextResult(await getRunActions({ runId }));
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
    async ({ pollIntervalSeconds, runId, timeoutSeconds }) => {
      try {
        return createTextResult(await waitForRun({ pollIntervalSeconds, runId, timeoutSeconds }));
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
    },
    async () => {
      try {
        return createTextResult(await revertLastUpdate());
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
    async ({ flow }) => {
      try {
        return createTextResult(await validateCurrentFlow({ flow }));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  return server;
};
