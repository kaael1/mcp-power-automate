import { z } from 'zod';

export const bridgePort = Number(process.env.POWER_AUTOMATE_BRIDGE_PORT || 17373);
export const bridgeHost = process.env.POWER_AUTOMATE_BRIDGE_HOST || '127.0.0.1';
export const bridgeOrigin = `http://${bridgeHost}:${bridgePort}`;
export const editorSchema = 'https://power-automate-tools.local/flow-editor.json#';

export const flowIdSchema = z.string().trim().min(1, 'flowId is required');
export const envIdSchema = z.string().trim().min(1, 'envId is required');
export const tokenSchema = z.string().trim().min(1, 'token is required');
export const baseUrlSchema = z.string().url('baseUrl must be a valid URL');
export const selectionSourceSchema = z.enum(['clone-result', 'create-result', 'manual', 'tab-capture']);

export const sessionSchema = z.object({
  apiToken: tokenSchema,
  apiUrl: baseUrlSchema,
  capturedAt: z.string().trim().min(1, 'capturedAt is required'),
  envId: envIdSchema,
  flowId: flowIdSchema,
  legacyApiUrl: baseUrlSchema.optional(),
  legacyToken: tokenSchema.optional(),
  portalUrl: z.string().url().optional(),
});

export const flowContentSchema = z.object({
  connectionReferences: z.record(z.string(), z.unknown()),
  definition: z.record(z.string(), z.unknown()),
});

export const flowCatalogItemSchema = z.object({
  actionTypes: z.array(z.string()).optional(),
  createdTime: z.string().nullable().optional(),
  displayName: z.string().trim().min(1, 'displayName is required'),
  envId: envIdSchema,
  flowId: flowIdSchema,
  lastModifiedTime: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  triggerTypes: z.array(z.string()).optional(),
  userType: z.string().nullable().optional(),
});

export const flowCatalogSchema = z.object({
  capturedAt: z.string().trim().min(1, 'capturedAt is required'),
  envId: envIdSchema,
  flows: z.array(flowCatalogItemSchema),
  source: z.string().trim().min(1, 'source is required'),
});

export const activeTargetSchema = z.object({
  displayName: z.string().nullable().optional(),
  envId: envIdSchema,
  flowId: flowIdSchema,
  selectedAt: z.string().trim().min(1, 'selectedAt is required'),
  selectionSource: selectionSourceSchema,
});

export const updateFlowInputSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  flow: flowContentSchema,
});

export const validateFlowInputSchema = z.object({
  flow: flowContentSchema,
});

export const flowSnapshotSchema = z.object({
  capturedAt: z.string().trim().min(1, 'capturedAt is required'),
  displayName: z.string().optional(),
  envId: envIdSchema,
  flow: flowContentSchema,
  flowId: flowIdSchema,
  source: z.string().trim().min(1, 'source is required'),
});

export const tokenCandidateSchema = z.object({
  aud: z.string().trim().min(1, 'aud is required'),
  exp: z.number().nullable().optional(),
  hasFlowRead: z.boolean().optional(),
  hasFlowWrite: z.boolean().optional(),
  score: z.number().optional(),
  scope: z.string().optional(),
  source: z.string().trim().min(1, 'source is required'),
  token: tokenSchema,
});

export const tokenAuditSchema = z.object({
  candidates: z.array(tokenCandidateSchema),
  capturedAt: z.string().trim().min(1, 'capturedAt is required'),
  envId: envIdSchema.optional(),
  flowId: flowIdSchema.optional(),
  portalUrl: z.string().url().optional(),
  source: z.string().trim().min(1, 'source is required'),
});

export const normalizedFlowSchema = z.object({
  displayName: z.string().optional(),
  envId: envIdSchema,
  environment: z.unknown().nullable().optional(),
  flow: z.object({
    $schema: z.string().optional(),
    connectionReferences: z.record(z.string(), z.unknown()),
    definition: z.record(z.string(), z.unknown()),
  }),
  flowId: flowIdSchema,
  source: z.string().optional(),
});

export const updateSummarySchema = z.object({
  afterActionCount: z.number().int().nonnegative(),
  afterDisplayName: z.string(),
  afterTriggerCount: z.number().int().nonnegative(),
  beforeActionCount: z.number().int().nonnegative(),
  beforeDisplayName: z.string(),
  beforeTriggerCount: z.number().int().nonnegative(),
  changedActionNames: z.array(z.string()),
  changedDefinition: z.boolean(),
  changedDisplayName: z.boolean().optional(),
  changedFlowBody: z.boolean().optional(),
});

export const lastUpdateSchema = z.object({
  after: normalizedFlowSchema,
  before: normalizedFlowSchema,
  capturedAt: z.string().trim().min(1, 'capturedAt is required'),
  envId: envIdSchema,
  flowId: flowIdSchema,
  summary: updateSummarySchema,
});

export const runSummarySchema = z.object({
  endTime: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  failedActionName: z.string().nullable().optional(),
  flowId: flowIdSchema,
  runId: z.string().trim().min(1, 'runId is required'),
  startTime: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  triggerName: z.string().nullable().optional(),
});

export const lastRunSchema = z.object({
  capturedAt: z.string().trim().min(1, 'capturedAt is required'),
  envId: envIdSchema,
  flowId: flowIdSchema,
  run: runSummarySchema.nullable(),
});

export const listRunsInputSchema = z.object({
  limit: z.number().int().positive().max(50).optional(),
});

export const listFlowsInputSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  query: z.string().trim().min(1).optional(),
});

export const setActiveFlowInputSchema = z.object({
  flowId: flowIdSchema,
});

export const createFlowInputSchema = z.object({
  displayName: z.string().trim().min(1, 'displayName is required'),
  triggerType: z.enum(['recurrence', 'request']).optional(),
});

export const cloneFlowInputSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  makeActive: z.boolean().optional(),
  sourceFlowId: flowIdSchema,
});

export const getRunInputSchema = z.object({
  runId: z.string().trim().min(1, 'runId is required'),
});

export const waitForRunInputSchema = z.object({
  pollIntervalSeconds: z.number().int().positive().max(30).optional(),
  runId: z.string().trim().min(1).optional(),
  timeoutSeconds: z.number().int().positive().max(600).optional(),
});

export const triggerCallbackInputSchema = z.object({
  triggerName: z.string().trim().min(1).optional(),
});

export const invokeTriggerInputSchema = z.object({
  body: z.unknown().optional(),
  triggerName: z.string().trim().min(1).optional(),
});
