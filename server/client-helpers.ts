import type {
  FlowCatalog,
  FlowCatalogItem,
  LastUpdate,
  NormalizedFlow,
  RunSummary,
} from './schemas.js';

export const TERMINAL_RUN_STATUSES = new Set(['cancelled', 'canceled', 'failed', 'skipped', 'succeeded', 'timedout']);

const summarizeFlowForHistory = (normalizedFlow: NormalizedFlow) => {
  const actions = normalizedFlow.flow.definition.actions ?? {};
  const triggers = normalizedFlow.flow.definition.triggers ?? {};

  return {
    actionCount: Object.keys(actions).length,
    actionNames: Object.keys(actions),
    displayName: normalizedFlow.displayName ?? '',
    triggerCount: Object.keys(triggers).length,
  };
};

export const ensureTrailingSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`);

export const buildRequestUrl = (baseUrl: string, resourcePath: string, apiVersion: string) => {
  const url = new URL(resourcePath, ensureTrailingSlash(baseUrl));
  url.searchParams.set('api-version', apiVersion);
  return url;
};

export const normalizeIssues = (issues: unknown) => {
  if (Array.isArray(issues)) return issues;
  if (Array.isArray((issues as { value?: unknown[] } | null | undefined)?.value)) {
    return (issues as { value: unknown[] }).value;
  }

  return [];
};

export const extractNameFromId = (value: string | null | undefined) => {
  if (!value) return null;

  const parts = value.split('/').filter(Boolean);
  return parts.at(-1) ?? null;
};

export const mergeCatalogItems = (...collections: FlowCatalogItem[][]) => {
  const byFlowId = new Map<string, FlowCatalogItem>();

  for (const collection of collections) {
    for (const flow of collection) {
      const current = byFlowId.get(flow.flowId);

      if (!current) {
        byFlowId.set(flow.flowId, flow);
        continue;
      }

      byFlowId.set(flow.flowId, {
        ...current,
        accessScope:
          current.accessScope === 'owned' && flow.accessScope !== 'owned'
            ? flow.accessScope
            : current.accessScope,
        creatorObjectId: current.creatorObjectId || flow.creatorObjectId || null,
        sharingType: current.sharingType || flow.sharingType || null,
        userType: current.userType || flow.userType || null,
      });
    }
  }

  return [...byFlowId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
};

export const filterCatalogFlows = (catalog: FlowCatalog, options: { limit?: number; query?: string } = {}) => {
  const limit = options.limit ?? 100;
  const normalizedQuery = options.query?.trim().toLowerCase() || null;
  const filteredFlows = normalizedQuery
    ? catalog.flows.filter((flow) => flow.displayName.toLowerCase().includes(normalizedQuery))
    : catalog.flows;

  return {
    ...catalog,
    flows: filteredFlows.slice(0, limit),
    total: filteredFlows.length,
  };
};

export const createLastUpdateRecord = ({
  after,
  before,
}: {
  after: NormalizedFlow;
  before: NormalizedFlow;
}): LastUpdate => {
  const beforeSummary = summarizeFlowForHistory(before);
  const afterSummary = summarizeFlowForHistory(after);
  const changedDefinition =
    JSON.stringify(before.flow.definition) !== JSON.stringify(after.flow.definition) ||
    JSON.stringify(before.flow.connectionReferences) !== JSON.stringify(after.flow.connectionReferences);

  return {
    after,
    before,
    capturedAt: new Date().toISOString(),
    envId: after.envId,
    flowId: after.flowId,
    summary: {
      afterActionCount: afterSummary.actionCount,
      afterDisplayName: afterSummary.displayName,
      afterTriggerCount: afterSummary.triggerCount,
      beforeActionCount: beforeSummary.actionCount,
      beforeDisplayName: beforeSummary.displayName,
      beforeTriggerCount: beforeSummary.triggerCount,
      changedActionNames: [...new Set([...beforeSummary.actionNames, ...afterSummary.actionNames])].filter(
        (name) => !beforeSummary.actionNames.includes(name) || !afterSummary.actionNames.includes(name),
      ),
      changedDefinition,
      changedDisplayName: before.displayName !== after.displayName,
      changedFlowBody: changedDefinition,
    },
  };
};

export const withFailedAction = (
  run: RunSummary,
  actions: Array<{ errorMessage?: string | null; name?: string | null; status?: string | null }>,
): RunSummary => {
  const failedAction =
    actions.find((action) => ['failed', 'timedout', 'cancelled', 'canceled'].includes((action.status || '').toLowerCase())) ||
    actions.find((action) => action.errorMessage && !['skipped', 'succeeded'].includes((action.status || '').toLowerCase()));

  return {
    ...run,
    errorMessage: run.errorMessage || failedAction?.errorMessage || null,
    failedActionName: failedAction?.name || null,
  };
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
