import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  getCurrentFlow,
  getLastRunSummary,
  getLastUpdateSummary,
  getLatestRun,
  getRun,
  getRunActions,
  getTriggerCallbackUrl,
  getStatus,
  invokeTrigger,
  listRuns,
  revertLastUpdate,
  updateCurrentFlow,
  validateCurrentFlow,
  waitForRun,
} from './power-automate-client.mjs';
import {
  getRunInputSchema,
  invokeTriggerInputSchema,
  listRunsInputSchema,
  triggerCallbackInputSchema,
  updateFlowInputSchema,
  validateFlowInputSchema,
  waitForRunInputSchema,
} from './schemas.mjs';

const createTextResult = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload,
});

const createErrorResult = (error) => ({
  content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

const buildHealthPayload = () => ({
  lastRun: getLastRunSummary(),
  lastUpdate: getLastUpdateSummary(),
  status: getStatus(),
});

const createJsonResource = (uri, payload) => ({
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
    version: '0.1.0',
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
    'get_status',
    {
      description: 'Show whether a Power Automate browser session is captured and which flow is currently active.',
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
      description: 'Fetch the currently captured Power Automate flow and return a normalized editable payload.',
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
        'Update the currently captured flow using the normalized flow payload returned by get_flow. The existing environment metadata is preserved automatically.',
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
      description: 'List recent runs for the currently active flow.',
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
      description: 'Return the most recent run for the currently active flow.',
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
      description: 'Return the callback URL for the current flow trigger when the trigger supports manual invocation.',
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
      description: 'Invoke the current flow trigger using its callback URL when the trigger supports manual execution.',
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
      description: 'Return details for a specific run of the currently active flow.',
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
      description: 'Return action-level statuses for a specific run of the currently active flow.',
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
      description: 'Return the last successful flow update recorded by the local bridge, including before/after summaries.',
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
        'Revert the current active flow to the last successfully recorded before-state. The active flow must match the last updated flow.',
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
        'Validate the currently captured flow definition using the legacy Power Automate validation endpoints when available.',
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
