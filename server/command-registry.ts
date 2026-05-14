import type { ZodRawShape, ZodTypeAny } from 'zod';
import { z } from 'zod';

import {
  applyFlowUpdate,
  cloneFlow,
  connectFlow,
  createFlow,
  getContextPayload,
  getCurrentFlow,
  getLastUpdateSummary,
  getLatestRun,
  getRun,
  getRunActions,
  getTriggerCallbackUrl,
  invokeTrigger,
  listFlows,
  listRuns,
  previewFlowUpdate,
  revertLastUpdate,
  validateCurrentFlow,
  waitForRun,
} from './power-automate-client.js';
import {
  addFlowToSolution,
  createFlowInSolution as createDataverseFlowInSolution,
  listEnvironmentVariables,
  listSolutionComponents,
  listSolutions,
} from './dataverse-solutions.js';
import {
  addFlowToSolutionInputSchema,
  cloneFlowInputSchema,
  connectFlowInputSchema,
  createFlowInSolutionInputSchema,
  createFlowInputSchema,
  getRunInputSchema,
  invokeTriggerInputSchema,
  listEnvironmentVariablesInputSchema,
  listFlowsInputSchema,
  listRunsInputSchema,
  listSolutionComponentsInputSchema,
  listSolutionsInputSchema,
  optionalTargetInputSchema,
  triggerCallbackInputSchema,
  updateFlowInputSchema,
  validateFlowInputSchema,
  waitForRunInputSchema,
  editorSchema,
} from './schemas.js';
import { saveActiveTarget } from './active-target-store.js';
import { getBridgeCommandBaseUrl, getBridgeMode, getBridgeRuntimeInfo } from './runtime-state.js';
import { toErrorPayload } from './errors.js';

const emptyInputSchema = z.object({});

type CommandRisk = 'read' | 'write';

export interface CommandDefinition {
  description: string;
  handler: (input: unknown) => Promise<unknown> | unknown;
  inputSchema: ZodTypeAny;
  name: string;
  risk: CommandRisk;
}

const createCommand = <TInputSchema extends ZodTypeAny>(
  definition: Omit<CommandDefinition, 'handler' | 'inputSchema'> & {
    handler: (input: z.infer<TInputSchema>) => Promise<unknown> | unknown;
    inputSchema: TInputSchema;
  },
): CommandDefinition => ({
  ...definition,
  handler: (input: unknown) => definition.handler(input as z.infer<TInputSchema>),
});

const createFlowInSolution = async ({
  addRequiredComponents,
  displayName,
  doNotIncludeSubcomponents,
  envId,
  solutionUniqueName,
  triggerType,
}: z.infer<typeof createFlowInSolutionInputSchema>) => {
  const created = await createDataverseFlowInSolution({
    addRequiredComponents,
    displayName,
    doNotIncludeSubcomponents,
    envId,
    solutionUniqueName,
    triggerType,
  });
  const activeTarget = await saveActiveTarget({
    displayName: created.displayName,
    envId: created.envId,
    flowId: created.flowId,
    selectedAt: new Date().toISOString(),
    selectionSource: 'create-result',
  });

  return {
    activeTarget,
    flow: {
      displayName: created.displayName,
      envId: created.envId,
      environment: null,
      flow: {
        $schema: editorSchema,
        ...created.flow,
      },
      flowId: created.flowId,
      source: created.source,
    },
    solutionComponent: created.solutionComponent,
  };
};

export const commandDefinitions: CommandDefinition[] = [
  createCommand({
    description: 'Return the current Power Automate context, capabilities, selection, and cached summaries.',
    handler: () => getContextPayload({ bridgeMode: getBridgeMode() }),
    inputSchema: emptyInputSchema,
    name: 'get_context',
    risk: 'read',
  }),
  createCommand({
    description: 'Return bridge identity, diagnostics, public command names, and current Power Automate readiness.',
    handler: () => ({
      bridge: getBridgeRuntimeInfo(),
      commands: getCommandMetadata(),
      context: getContextPayload({ bridgeMode: getBridgeMode() }).context,
      ok: true,
    }),
    inputSchema: emptyInputSchema,
    name: 'doctor',
    risk: 'read',
  }),
  createCommand({
    description: 'Connect the MCP to a flow using flowId, tabId, or nameQuery. Returns candidates if the request is ambiguous.',
    handler: (input) => connectFlow(input),
    inputSchema: connectFlowInputSchema,
    name: 'connect_flow',
    risk: 'write',
  }),
  createCommand({
    description: 'List flows from live catalog plus browser-captured flows in the current environment.',
    handler: (input) => listFlows(input),
    inputSchema: listFlowsInputSchema,
    name: 'list_flows',
    risk: 'read',
  }),
  createCommand({
    description: 'List visible Dataverse solutions in the current or provided environment without changing them.',
    handler: (input) => listSolutions(input),
    inputSchema: listSolutionsInputSchema,
    name: 'list_solutions',
    risk: 'read',
  }),
  createCommand({
    description: 'List Dataverse solution components for a solution unique name without changing them.',
    handler: (input) => listSolutionComponents(input),
    inputSchema: listSolutionComponentsInputSchema,
    name: 'list_solution_components',
    risk: 'read',
  }),
  createCommand({
    description: 'List Dataverse environment variable definitions and current values without changing them.',
    handler: (input) => listEnvironmentVariables(input),
    inputSchema: listEnvironmentVariablesInputSchema,
    name: 'list_environment_variables',
    risk: 'read',
  }),
  createCommand({
    description: 'Add an existing cloud flow to an unmanaged Dataverse solution.',
    handler: (input) => addFlowToSolution(input),
    inputSchema: addFlowToSolutionInputSchema,
    name: 'add_flow_to_solution',
    risk: 'write',
  }),
  createCommand({
    description: 'Fetch the selected Power Automate flow target and return a normalized editable payload.',
    handler: (input) => getCurrentFlow(input),
    inputSchema: optionalTargetInputSchema,
    name: 'get_flow',
    risk: 'read',
  }),
  createCommand({
    description: 'Preview a flow edit without saving it, returning the proposed review diff and summary.',
    handler: (input) => previewFlowUpdate(input),
    inputSchema: updateFlowInputSchema,
    name: 'preview_flow_update',
    risk: 'read',
  }),
  createCommand({
    description: 'Validate a flow definition using the flow service validation API when available.',
    handler: (input) => validateCurrentFlow(input),
    inputSchema: validateFlowInputSchema,
    name: 'validate_flow',
    risk: 'read',
  }),
  createCommand({
    description: 'Apply a flow edit and return the saved flow plus the persisted review diff.',
    handler: (input) => applyFlowUpdate(input),
    inputSchema: updateFlowInputSchema,
    name: 'apply_flow_update',
    risk: 'write',
  }),
  createCommand({
    description: 'Return the last successful flow update recorded by the local bridge.',
    handler: () => ({ lastUpdate: getLastUpdateSummary() }),
    inputSchema: emptyInputSchema,
    name: 'get_last_update',
    risk: 'read',
  }),
  createCommand({
    description: 'Revert the selected flow target to the last recorded before-state.',
    handler: (input) => revertLastUpdate(input),
    inputSchema: optionalTargetInputSchema,
    name: 'revert_last_update',
    risk: 'write',
  }),
  createCommand({
    description: 'List recent runs for the selected flow target.',
    handler: (input) => listRuns(input),
    inputSchema: listRunsInputSchema,
    name: 'list_runs',
    risk: 'read',
  }),
  createCommand({
    description: 'Return the most recent run for the selected flow target.',
    handler: (input) => getLatestRun(input),
    inputSchema: optionalTargetInputSchema,
    name: 'get_latest_run',
    risk: 'read',
  }),
  createCommand({
    description: 'Return details for a specific run of the selected flow target.',
    handler: (input) => getRun(input),
    inputSchema: getRunInputSchema,
    name: 'get_run',
    risk: 'read',
  }),
  createCommand({
    description: 'Return action-level statuses for a specific run of the selected flow target.',
    handler: (input) => getRunActions(input),
    inputSchema: getRunInputSchema,
    name: 'get_run_actions',
    risk: 'read',
  }),
  createCommand({
    description: 'Poll the latest run or a specific run until it reaches a terminal status or timeout.',
    handler: (input) => waitForRun(input),
    inputSchema: waitForRunInputSchema,
    name: 'wait_for_run',
    risk: 'read',
  }),
  createCommand({
    description: 'Return the callback URL for the selected flow trigger when it supports manual invocation.',
    handler: (input) => getTriggerCallbackUrl(input),
    inputSchema: triggerCallbackInputSchema,
    name: 'get_trigger_callback_url',
    risk: 'read',
  }),
  createCommand({
    description: 'Invoke the selected flow trigger using its callback URL when it supports manual execution.',
    handler: (input) => invokeTrigger(input),
    inputSchema: invokeTriggerInputSchema,
    name: 'invoke_trigger',
    risk: 'write',
  }),
  createCommand({
    description: 'Create a new blank flow in the current environment and connect it as the active target.',
    handler: (input) => createFlow(input),
    inputSchema: createFlowInputSchema,
    name: 'create_flow',
    risk: 'write',
  }),
  createCommand({
    description: 'Create a new blank flow in the current environment, add it to an unmanaged solution, and connect it as the active target.',
    handler: (input) => createFlowInSolution(input),
    inputSchema: createFlowInSolutionInputSchema,
    name: 'create_flow_in_solution',
    risk: 'write',
  }),
  createCommand({
    description: 'Clone an existing flow inside the current environment and optionally connect the clone.',
    handler: (input) => cloneFlow(input),
    inputSchema: cloneFlowInputSchema,
    name: 'clone_flow',
    risk: 'write',
  }),
] as const;

export type CommandName = (typeof commandDefinitions)[number]['name'];

export const publicCommandNames = commandDefinitions.map((command) => command.name);

export const getCommandMetadata = () =>
  commandDefinitions.map(({ description, name, risk }) => ({
    description,
    name,
    risk,
  }));

export const getCommandDefinition = (name: string) => commandDefinitions.find((command) => command.name === name) || null;

const proxyCommand = async (name: string, input: unknown) => {
  const response = await fetch(`${getBridgeCommandBaseUrl()}/${encodeURIComponent(name)}`, {
    body: JSON.stringify(input ?? {}),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = toErrorPayload(payload?.error || payload);
    throw new Error(error.message);
  }

  return payload?.result ?? payload;
};

export const executeCommand = async (name: string, input: unknown = {}, options: { local?: boolean } = {}) => {
  const definition = getCommandDefinition(name);

  if (!definition) {
    throw new Error(`Unknown Power Automate command: ${name}`);
  }

  const parsed = definition.inputSchema.parse(input ?? {});

  if (!options.local && getBridgeMode() === 'reused') {
    return proxyCommand(name, parsed);
  }

  return definition.handler(parsed);
};

export const getCommandInputShape = (definition: CommandDefinition) => {
  const schema = definition.inputSchema;
  return schema instanceof z.ZodObject ? (schema.shape as ZodRawShape) : {};
};
