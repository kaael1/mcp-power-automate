import type {
  FlowCatalog,
  FlowCatalogItem,
  FlowReview,
  FlowReviewItem,
  FlowReviewSection,
  ReviewChangeType,
  ReviewSectionId,
  LastUpdate,
  NormalizedFlow,
  RunSummary,
} from './schemas.js';

export const TERMINAL_RUN_STATUSES = new Set(['cancelled', 'canceled', 'failed', 'skipped', 'succeeded', 'timedout']);

const REVIEW_SECTION_ORDER: ReviewSectionId[] = ['metadata', 'triggers', 'actions', 'connections', 'other'];

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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const areEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const humanizeToken = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatPath = (parts: string[]) => parts.join('.');

const formatDetailPath = (parts: string[]) =>
  parts.length > 0 ? parts.map((part) => humanizeToken(part)).join(' > ') : null;

const classifyReviewPath = (pathParts: string[]) => {
  if (pathParts[0] === 'displayName') {
    return {
      detailPath: null,
      entityName: null,
      label: 'Flow name',
      sectionId: 'metadata' as ReviewSectionId,
    };
  }

  if (pathParts[0] === 'flow' && pathParts[1] === 'connectionReferences') {
    const entityName = pathParts[2] || null;
    const detailPath = formatDetailPath(pathParts.slice(3));

    return {
      detailPath,
      entityName,
      label: detailPath ? `Connection "${entityName}" · ${detailPath}` : `Connection "${entityName}"`,
      sectionId: 'connections' as ReviewSectionId,
    };
  }

  if (pathParts[0] === 'flow' && pathParts[1] === 'definition' && pathParts[2] === 'triggers') {
    const entityName = pathParts[3] || null;
    const detailPath = formatDetailPath(pathParts.slice(4));

    return {
      detailPath,
      entityName,
      label: detailPath ? `Trigger "${entityName}" · ${detailPath}` : `Trigger "${entityName}"`,
      sectionId: 'triggers' as ReviewSectionId,
    };
  }

  if (pathParts[0] === 'flow' && pathParts[1] === 'definition' && pathParts[2] === 'actions') {
    const entityName = pathParts[3] || null;
    const detailPath = formatDetailPath(pathParts.slice(4));

    return {
      detailPath,
      entityName,
      label: detailPath ? `Action "${entityName}" · ${detailPath}` : `Action "${entityName}"`,
      sectionId: 'actions' as ReviewSectionId,
    };
  }

  if (pathParts[0] === 'flow' && pathParts[1] === 'definition') {
    const detailPath = formatDetailPath(pathParts.slice(2));

    return {
      detailPath,
      entityName: null,
      label: detailPath ? `Definition · ${detailPath}` : 'Definition',
      sectionId: 'other' as ReviewSectionId,
    };
  }

  const detailPath = formatDetailPath(pathParts);

  return {
    detailPath,
    entityName: null,
    label: detailPath || 'Flow metadata',
    sectionId: 'metadata' as ReviewSectionId,
  };
};

const collectReviewChanges = (
  beforeValue: unknown,
  afterValue: unknown,
  pathParts: string[],
): Array<{
  afterValue?: unknown;
  beforeValue?: unknown;
  changeType: ReviewChangeType;
  pathParts: string[];
}> => {
  if (beforeValue === undefined && afterValue === undefined) {
    return [];
  }

  if (beforeValue === undefined) {
    return [{ afterValue, changeType: 'added', pathParts }];
  }

  if (afterValue === undefined) {
    return [{ beforeValue, changeType: 'removed', pathParts }];
  }

  if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
    const keys = [...new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)])].sort((left, right) =>
      left.localeCompare(right),
    );

    return keys.flatMap((key) => collectReviewChanges(beforeValue[key], afterValue[key], [...pathParts, key]));
  }

  if (areEqual(beforeValue, afterValue)) {
    return [];
  }

  return [{ afterValue, beforeValue, changeType: 'modified', pathParts }];
};

export const createFlowReview = ({
  after,
  before,
}: {
  after: NormalizedFlow;
  before: NormalizedFlow;
}): FlowReview => {
  const rawChanges = [
    ...collectReviewChanges(before.displayName ?? '', after.displayName ?? '', ['displayName']),
    ...collectReviewChanges(before.flow.connectionReferences, after.flow.connectionReferences, ['flow', 'connectionReferences']),
    ...collectReviewChanges(before.flow.definition, after.flow.definition, ['flow', 'definition']),
  ];

  const items = rawChanges
    .map((change) => {
      const path = formatPath(change.pathParts);
      const classification = classifyReviewPath(change.pathParts);

      return {
        afterValue: change.afterValue,
        beforeValue: change.beforeValue,
        changeType: change.changeType,
        detailPath: classification.detailPath,
        entityName: classification.entityName,
        id: `${classification.sectionId}:${path}:${change.changeType}`,
        label: classification.label,
        path,
        sectionId: classification.sectionId,
      } satisfies FlowReviewItem;
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  const sections = REVIEW_SECTION_ORDER.map((sectionId) => ({
    id: sectionId,
    items: items.filter((item) => item.sectionId === sectionId),
  })).filter((section) => section.items.length > 0) satisfies FlowReviewSection[];

  const changedSectionIds = sections.map((section) => section.id);
  const unchangedSectionIds = REVIEW_SECTION_ORDER.filter((sectionId) => !changedSectionIds.includes(sectionId));

  return {
    changedPaths: items.map((item) => item.path),
    sections,
    summary: {
      changedSectionIds,
      totalChanges: items.length,
      unchangedSectionIds,
    },
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
    review: createFlowReview({ after, before }),
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
