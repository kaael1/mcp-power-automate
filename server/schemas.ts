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
export const targetRefSchema = z.object({
  envId: envIdSchema,
  flowId: flowIdSchema,
});

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

export const capturedSessionSchema = sessionSchema.extend({
  lastSeenAt: z.string().trim().min(1, 'lastSeenAt is required'),
  tabId: z.number().int().nonnegative(),
});

export const selectedWorkTabSchema = z.object({
  selectedAt: z.string().trim().min(1, 'selectedAt is required'),
  tabId: z.number().int().nonnegative(),
});

export const flowContentSchema = z.object({
  connectionReferences: z.record(z.string(), z.any()),
  definition: z.record(z.string(), z.any()),
});

export const flowCatalogItemSchema = z.object({
  actionTypes: z.array(z.string()).optional(),
  accessScope: z.enum(['owned', 'portal-shared', 'shared-user']).optional(),
  createdTime: z.string().nullable().optional(),
  creatorObjectId: z.string().nullable().optional(),
  displayName: z.string().trim().min(1, 'displayName is required'),
  envId: envIdSchema,
  flowId: flowIdSchema,
  lastModifiedTime: z.string().nullable().optional(),
  sharingType: z.string().nullable().optional(),
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
  target: targetRefSchema.optional(),
});

export const validateFlowInputSchema = z.object({
  flow: flowContentSchema,
  target: targetRefSchema.optional(),
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
    connectionReferences: z.record(z.string(), z.any()),
    definition: z.record(z.string(), z.any()),
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

export const reviewSectionIdSchema = z.enum(['metadata', 'triggers', 'actions', 'connections', 'other']);
export const reviewChangeTypeSchema = z.enum(['added', 'modified', 'removed']);

export const flowReviewItemSchema = z.object({
  afterValue: z.unknown().optional(),
  beforeValue: z.unknown().optional(),
  changeType: reviewChangeTypeSchema,
  detailPath: z.string().nullable().optional(),
  entityName: z.string().nullable().optional(),
  id: z.string().trim().min(1, 'id is required'),
  label: z.string().trim().min(1, 'label is required'),
  path: z.string().trim().min(1, 'path is required'),
  sectionId: reviewSectionIdSchema,
});

export const flowReviewSectionSchema = z.object({
  id: reviewSectionIdSchema,
  items: z.array(flowReviewItemSchema),
});

export const flowReviewSummarySchema = z.object({
  changedSectionIds: z.array(reviewSectionIdSchema),
  totalChanges: z.number().int().nonnegative(),
  unchangedSectionIds: z.array(reviewSectionIdSchema),
});

export const flowReviewSchema = z.object({
  changedPaths: z.array(z.string()),
  sections: z.array(flowReviewSectionSchema),
  summary: flowReviewSummarySchema,
});

export const lastUpdateSchema = z.object({
  after: normalizedFlowSchema,
  before: normalizedFlowSchema,
  capturedAt: z.string().trim().min(1, 'capturedAt is required'),
  envId: envIdSchema,
  flowId: flowIdSchema,
  review: flowReviewSchema,
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
  target: targetRefSchema.optional(),
});

export const listFlowsInputSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  query: z.string().trim().min(1).optional(),
});

export const setActiveFlowInputSchema = z.object({
  flowId: flowIdSchema,
});

export const optionalTargetInputSchema = z.object({
  target: targetRefSchema.optional(),
});

export const selectWorkTabInputSchema = z.object({
  tabId: z.number().int().nonnegative(),
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
  target: targetRefSchema.optional(),
});

export const waitForRunInputSchema = z.object({
  pollIntervalSeconds: z.number().int().positive().max(30).optional(),
  runId: z.string().trim().min(1).optional(),
  target: targetRefSchema.optional(),
  timeoutSeconds: z.number().int().positive().max(600).optional(),
});

export const triggerCallbackInputSchema = z.object({
  triggerName: z.string().trim().min(1).optional(),
  target: targetRefSchema.optional(),
});

export const invokeTriggerInputSchema = z.object({
  body: z.unknown().optional(),
  target: targetRefSchema.optional(),
  triggerName: z.string().trim().min(1).optional(),
});

export const dataverseOrgRecordSchema = z.object({
  envId: envIdSchema,
  instanceApiUrl: baseUrlSchema,
  instanceUrl: baseUrlSchema,
  resolvedAt: z.string().trim().min(1, 'resolvedAt is required'),
  uniqueName: z.string().trim().min(1).optional(),
});

export const dataverseOrgMapSchema = z.object({
  records: z.record(z.string(), dataverseOrgRecordSchema),
});

const guidSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'must be a GUID');

export const dataverseUniqueNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'must start with a letter and contain only letters, digits, and underscores');

export const dataverseSchemaNameSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9]*_[A-Za-z][A-Za-z0-9_]*$/, 'must include a publisher prefix like "adres_..." (Microsoft default publishers also use digits, e.g. "cr7f66c_...")');

export const envVarTypeSchema = z.enum(['string', 'number', 'boolean', 'json', 'secret']);

export const componentTypeSchema = z.union([
  z.enum([
    'workflow',
    'environmentVariableDefinition',
    'environmentVariableValue',
    'connectionReference',
    'publisher',
    'solution',
  ]),
  z.number().int().nonnegative(),
]);

export const listSolutionsInputSchema = z.object({
  envId: envIdSchema.optional(),
  includeManaged: z.boolean().optional(),
  query: z.string().trim().min(1).optional(),
});

export const createSolutionInputSchema = z.object({
  envId: envIdSchema.optional(),
  uniqueName: dataverseUniqueNameSchema,
  friendlyName: z.string().trim().min(1, 'friendlyName is required'),
  version: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+){0,3}$/, 'must be a 1-4 part dotted version, e.g. "1.0.0.0"')
    .optional(),
  description: z.string().trim().min(1).optional(),
  publisherUniqueName: dataverseUniqueNameSchema,
});

export const createEnvironmentVariableInputSchema = z.object({
  envId: envIdSchema.optional(),
  solutionUniqueName: dataverseUniqueNameSchema,
  schemaName: dataverseSchemaNameSchema,
  displayName: z.string().trim().min(1, 'displayName is required'),
  type: envVarTypeSchema,
  defaultValue: z.string().optional(),
  initialValue: z.string().optional(),
  description: z.string().trim().min(1).optional(),
  isRequired: z.boolean().optional(),
});

export const setEnvVarValueInputSchema = z.object({
  envId: envIdSchema.optional(),
  schemaName: dataverseSchemaNameSchema,
  value: z.string(),
  solutionUniqueName: dataverseUniqueNameSchema.optional(),
});

export const addExistingToSolutionInputSchema = z.object({
  envId: envIdSchema.optional(),
  solutionUniqueName: dataverseUniqueNameSchema,
  componentId: guidSchema,
  componentType: componentTypeSchema,
  addRequiredComponents: z.boolean().optional(),
  doNotIncludeSubcomponents: z.boolean().optional(),
});

export type FlowId = z.infer<typeof flowIdSchema>;
export type EnvId = z.infer<typeof envIdSchema>;
export type SelectionSource = z.infer<typeof selectionSourceSchema>;
export type TargetRef = z.infer<typeof targetRefSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type CapturedSession = z.infer<typeof capturedSessionSchema>;
export type SelectedWorkTab = z.infer<typeof selectedWorkTabSchema>;
export type FlowContent = z.infer<typeof flowContentSchema>;
export type FlowCatalogItem = z.infer<typeof flowCatalogItemSchema>;
export type FlowCatalog = z.infer<typeof flowCatalogSchema>;
export type ActiveTarget = z.infer<typeof activeTargetSchema>;
export type UpdateFlowInput = z.infer<typeof updateFlowInputSchema>;
export type ValidateFlowInput = z.infer<typeof validateFlowInputSchema>;
export type FlowSnapshot = z.infer<typeof flowSnapshotSchema>;
export type TokenCandidate = z.infer<typeof tokenCandidateSchema>;
export type TokenAudit = z.infer<typeof tokenAuditSchema>;
export type NormalizedFlow = z.infer<typeof normalizedFlowSchema>;
export type UpdateSummary = z.infer<typeof updateSummarySchema>;
export type ReviewSectionId = z.infer<typeof reviewSectionIdSchema>;
export type ReviewChangeType = z.infer<typeof reviewChangeTypeSchema>;
export type FlowReviewItem = z.infer<typeof flowReviewItemSchema>;
export type FlowReviewSection = z.infer<typeof flowReviewSectionSchema>;
export type FlowReviewSummary = z.infer<typeof flowReviewSummarySchema>;
export type FlowReview = z.infer<typeof flowReviewSchema>;
export type LastUpdate = z.infer<typeof lastUpdateSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type LastRun = z.infer<typeof lastRunSchema>;
export type ListRunsInput = z.infer<typeof listRunsInputSchema>;
export type ListFlowsInput = z.infer<typeof listFlowsInputSchema>;
export type SetActiveFlowInput = z.infer<typeof setActiveFlowInputSchema>;
export type OptionalTargetInput = z.infer<typeof optionalTargetInputSchema>;
export type SelectWorkTabInput = z.infer<typeof selectWorkTabInputSchema>;
export type CreateFlowInput = z.infer<typeof createFlowInputSchema>;
export type CloneFlowInput = z.infer<typeof cloneFlowInputSchema>;
export type GetRunInput = z.infer<typeof getRunInputSchema>;
export type WaitForRunInput = z.infer<typeof waitForRunInputSchema>;
export type TriggerCallbackInput = z.infer<typeof triggerCallbackInputSchema>;
export type InvokeTriggerInput = z.infer<typeof invokeTriggerInputSchema>;
export type DataverseOrgRecord = z.infer<typeof dataverseOrgRecordSchema>;
export type DataverseOrgMap = z.infer<typeof dataverseOrgMapSchema>;
export type EnvVarType = z.infer<typeof envVarTypeSchema>;
export type ComponentType = z.infer<typeof componentTypeSchema>;
export type ListSolutionsInput = z.infer<typeof listSolutionsInputSchema>;
export type CreateSolutionInput = z.infer<typeof createSolutionInputSchema>;
export type CreateEnvironmentVariableInput = z.infer<typeof createEnvironmentVariableInputSchema>;
export type SetEnvVarValueInput = z.infer<typeof setEnvVarValueInputSchema>;
export type AddExistingToSolutionInput = z.infer<typeof addExistingToSolutionInputSchema>;
