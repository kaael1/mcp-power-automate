import { getActiveTarget, saveActiveTarget } from './active-target-store.js';
import type { BridgeMode, CapabilityReasonCode, CapabilityStatus, ContextPayload, PowerAutomateContext } from './bridge-types.js';
import {
  buildRequestUrl,
  createLastUpdateRecord,
  extractNameFromId,
  filterCatalogFlows,
  mergeCatalogItems,
  normalizeIssues,
  sleep,
  TERMINAL_RUN_STATUSES,
  withFailedAction,
} from './client-helpers.js';
import { getFlowCatalogForEnv, saveFlowCatalog } from './flow-catalog-store.js';
import { getFlowSnapshot, getFlowSnapshotForFlow } from './flow-snapshot-store.js';
import { getLastRun, getLastRunForFlow, saveLastRun } from './last-run-store.js';
import type {
  ActiveTarget,
  CloneFlowInput,
  CreateFlowInput,
  FlowCatalog,
  FlowCatalogItem,
  FlowContent,
  LastRun,
  LastUpdate,
  ListFlowsInput,
  ListRunsInput,
  NormalizedFlow,
  RunSummary,
  Session,
  TargetRef,
  TriggerCallbackInput,
  UpdateFlowInput,
  ValidateFlowInput,
  WaitForRunInput,
} from './schemas.js';
import { editorSchema } from './schemas.js';
import { PowerAutomateSessionError } from './errors.js';
import { getSession } from './session-store.js';
import { getStoreDiagnostics } from './store-utils.js';
import { getTokenAudit } from './token-audit-store.js';
import { hasLegacyCompatibleToken } from './token-compat.js';
import { getLastUpdate, getLastUpdateForFlow, saveLastUpdate } from './update-history-store.js';

const MODERN_API_VERSION = '1';
const LEGACY_API_VERSION = '2016-11-01';
const LEGACY_FLOW_BASE_URL = 'https://api.flow.microsoft.com/';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface PreferredLegacySession {
  baseUrl: string;
  source: string;
  token: string;
}

type TargetSession = Session & {
  flowId: string;
  targetDisplayName: string | null;
  targetSelectedAt: string | null;
  targetSelectionSource: string | null;
};

type ResolvedTarget = {
  displayName: string | null;
  envId: string;
  flowId: string;
  selectedAt: string | null;
  selectionSource: string | null;
};

type RunActionSummary = {
  code: string | null;
  endTime: string | null;
  errorMessage: string | null;
  name: string | null;
  startTime: string | null;
  status: string | null;
  type: string | null;
};

const ensureSession = (): Session => {
  const session = getSession();

  if (!session) {
    throw new PowerAutomateSessionError({
      code: 'NO_SESSION',
      message: 'No active browser session found. Open or refresh the target flow in Power Automate with the extension enabled.',
    });
  }

  return session;
};

const createTabTargetFromSession = (session: Session): ActiveTarget | null => {
  if (!session.flowId) return null;

  return {
    displayName: null,
    envId: session.envId,
    flowId: session.flowId,
    selectedAt: session.capturedAt,
    selectionSource: 'tab-capture',
  };
};

const getActiveOrTabTarget = (session: Session): ActiveTarget | null => {
  const activeTarget = getActiveTarget();

  if (activeTarget?.envId === session.envId) {
    return activeTarget;
  }

  return createTabTargetFromSession(session);
};

const resolveFlowDisplayName = ({
  displayName,
  envId,
  flowId,
}: {
  displayName?: string | null;
  envId: string;
  flowId: string;
}) => {
  if (displayName) return displayName;

  const catalog = getFlowCatalogForEnv(envId);
  const catalogMatch = catalog?.flows?.find((flow) => flow.flowId === flowId);
  if (catalogMatch?.displayName) return catalogMatch.displayName;

  const snapshot = getFlowSnapshotForFlow({ envId, flowId });
  return snapshot?.displayName || snapshot?.flow?.definition?.metadata?.displayName || null;
};

const resolveTarget = (session: Session, target?: TargetRef): ResolvedTarget | null => {
  if (target?.flowId) {
    return {
      displayName: resolveFlowDisplayName(target),
      envId: target.envId,
      flowId: target.flowId,
      selectedAt: null,
      selectionSource: 'direct-target',
    };
  }

  const activeTarget = getActiveOrTabTarget(session);

  if (!activeTarget?.flowId) return null;

  return {
    displayName: resolveFlowDisplayName(activeTarget),
    envId: activeTarget.envId,
    flowId: activeTarget.flowId,
    selectedAt: activeTarget.selectedAt,
    selectionSource: activeTarget.selectionSource,
  };
};

const ensureTargetSession = (target?: TargetRef): TargetSession => {
  const session = ensureSession();
  const resolvedTarget = resolveTarget(session, target);

  if (!resolvedTarget?.flowId) {
    throw new PowerAutomateSessionError({
      code: 'NO_TARGET',
      message:
        'No active flow target is selected. Use list_flows and select_flow, or capture the current tab as the active target first.',
    });
  }

  return {
    ...session,
    envId: resolvedTarget.envId,
    flowId: resolvedTarget.flowId,
    targetDisplayName: resolvedTarget.displayName || null,
    targetSelectedAt: resolvedTarget.selectedAt,
    targetSelectionSource: resolvedTarget.selectionSource,
  };
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const toApiError = (response: Response, body: unknown) => {
  if (response.status === 401 || response.status === 403) {
    return new PowerAutomateSessionError({
      code: 'SESSION_EXPIRED',
      message:
        'The captured Power Automate session is expired or invalid. Reopen or refresh the flow in the browser to capture a fresh token.',
      retryable: true,
    });
  }

  const parsedBody = body as AnyRecord | string | null;
  const message =
    (parsedBody as AnyRecord | null)?.error?.message ||
    (parsedBody as AnyRecord | null)?.message ||
    (typeof parsedBody === 'string' && parsedBody) ||
    `Power Automate API request failed with ${response.status} ${response.statusText}.`;

  return new Error(message);
};

const requestJson = async <T = AnyRecord>({
  apiVersion,
  baseUrl,
  body,
  method = 'GET',
  resourcePath,
  token,
}: {
  apiVersion: string;
  baseUrl: string;
  body?: unknown;
  method?: string;
  resourcePath: string;
  token: string;
}) => {
  const requestUrl = buildRequestUrl(baseUrl, resourcePath, apiVersion);
  const response = await fetch(requestUrl, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    method,
  });
  const parsedBody = await readResponseBody(response);

  if (!response.ok) {
    throw toApiError(response, parsedBody);
  }

  return parsedBody as T;
};

const getCurrentFlowResourcePath = (flowId: string) => `powerautomate/flows/${flowId}`;

const getLegacyFlowBasePath = (envId: string, flowId: string) =>
  `providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}`;

const getLegacyFlowsCollectionPath = (envId: string) =>
  `providers/Microsoft.ProcessSimple/environments/${envId}/flows`;

const getPreferredLegacySession = (session: Session): PreferredLegacySession | null => {
  if (session.legacyApiUrl && session.legacyToken) {
    return {
      baseUrl: session.legacyApiUrl,
      source: 'captured-legacy-session',
      token: session.legacyToken,
    };
  }

  if (hasLegacyCompatibleToken(session.apiToken)) {
    return {
      baseUrl: LEGACY_FLOW_BASE_URL,
      source: 'captured-modern-session',
      token: session.apiToken,
    };
  }

  const tokenAudit = getTokenAudit();
  const preferredToken =
    tokenAudit?.candidates?.find((candidate) => candidate.aud === 'https://service.flow.microsoft.com/') ||
    tokenAudit?.candidates?.find((candidate) => candidate.aud === 'https://service.powerapps.com/');

  if (!preferredToken) return null;

  return {
    baseUrl: LEGACY_FLOW_BASE_URL,
    source: preferredToken.source,
    token: preferredToken.token,
  };
};

const normalizeFlow = (session: Pick<Session, 'envId' | 'flowId'>, flowResponse: AnyRecord): NormalizedFlow => {
  const properties = flowResponse?.properties || {};

  return {
    displayName: properties.displayName || '',
    envId: session.envId,
    environment: properties.environment ?? null,
    flow: {
      $schema: editorSchema,
      connectionReferences: properties.connectionReferences || {},
      definition: properties.definition || {},
    },
    flowId: session.flowId,
  };
};

const normalizeFlowCatalogItem = (
  session: Session,
  flowResponse: AnyRecord,
  accessScope: FlowCatalogItem['accessScope'] = 'owned',
): FlowCatalogItem | null => {
  const properties = flowResponse?.properties || {};
  const definitionSummary = properties.definitionSummary || {};
  const flowId = flowResponse?.name || null;

  if (!flowId) return null;

  return {
    actionTypes: Array.isArray(definitionSummary.actions)
      ? definitionSummary.actions.map((action: AnyRecord) => action?.type).filter(Boolean)
      : [],
    accessScope,
    createdTime: properties.createdTime || null,
    creatorObjectId: properties.creator?.objectId || null,
    displayName: properties.displayName || flowId || 'Untitled flow',
    envId: session.envId,
    flowId,
    lastModifiedTime: properties.lastModifiedTime || null,
    sharingType: properties.sharingType || null,
    state: properties.state || null,
    triggerTypes: Array.isArray(definitionSummary.triggers)
      ? definitionSummary.triggers.map((trigger: AnyRecord) => trigger?.type).filter(Boolean)
      : [],
    userType: properties.userType || null,
  };
};

const normalizeLegacyFlow = (session: Pick<Session, 'envId' | 'flowId'>, flowResponse: AnyRecord): NormalizedFlow => {
  const properties = flowResponse?.properties || {};

  return {
    displayName: properties.displayName || '',
    envId: session.envId,
    environment: properties.environment ?? null,
    flow: {
      $schema: properties.definition?.$schema || editorSchema,
      connectionReferences: properties.connectionReferences || {},
      definition: properties.definition || {},
    },
    flowId: session.flowId,
    source: 'legacy-api',
  };
};

const normalizeSnapshot = (snapshot: { displayName?: string; envId: string; flow: FlowContent; flowId: string; source: string }): NormalizedFlow => ({
  displayName: snapshot.displayName || '',
  envId: snapshot.envId,
  environment: null,
  flow: {
    $schema: editorSchema,
    connectionReferences: snapshot.flow.connectionReferences || {},
    definition: snapshot.flow.definition || {},
  },
  flowId: snapshot.flowId,
  source: snapshot.source,
});

const resolveCurrentTabFlowName = (session: Session) => {
  if (!session.flowId) return null;
  return resolveFlowDisplayName({
    envId: session.envId,
    flowId: session.flowId,
  });
};

const fetchRawFlowModern = async (session: Pick<TargetSession, 'apiToken' | 'apiUrl' | 'flowId'>, flowId = session.flowId) =>
  requestJson<AnyRecord>({
    apiVersion: MODERN_API_VERSION,
    baseUrl: session.apiUrl,
    method: 'GET',
    resourcePath: getCurrentFlowResourcePath(flowId),
    token: session.apiToken,
  });

const fetchRawFlowLegacy = async (session: Session & { envId: string; flowId: string }, flowId = session.flowId) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  return requestJson<AnyRecord>({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: getLegacyFlowBasePath(session.envId, flowId),
    token: legacySession.token,
  });
};

const queryLegacyFlows = async (session: Session, options: { filter?: string } = {}) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  const resourcePath = getLegacyFlowsCollectionPath(session.envId);
  const requestUrl = buildRequestUrl(legacySession.baseUrl, resourcePath, LEGACY_API_VERSION);

  if (options.filter) {
    requestUrl.searchParams.set('$filter', options.filter);
  }

  const response = await fetch(requestUrl, {
    headers: {
      Authorization: legacySession.token,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });
  const parsedBody = await readResponseBody(response);

  if (!response.ok) {
    throw toApiError(response, parsedBody);
  }

  return {
    response: parsedBody as AnyRecord,
    source: legacySession.source,
  };
};

const listFlowsLegacy = async (session: Session): Promise<FlowCatalog> => {
  const [baseResult, sharedUserResult, portalSharedResult] = await Promise.all([
    queryLegacyFlows(session),
    queryLegacyFlows(session, { filter: "properties/userType eq 'User'" }).catch(() => ({
      response: { value: [] },
      source: null,
    })),
    queryLegacyFlows(session, {
      filter: "properties/sharingType eq 'Coauthor' and properties/userType eq 'Owner'",
    }).catch(() => ({
      response: { value: [] },
      source: null,
    })),
  ]);

  const baseFlows = Array.isArray(baseResult.response?.value)
    ? baseResult.response.value
        .map((flow: AnyRecord) => normalizeFlowCatalogItem(session, flow, 'owned'))
        .filter((flow): flow is FlowCatalogItem => Boolean(flow))
    : [];

  const sharedUserFlows = Array.isArray(sharedUserResult.response?.value)
    ? sharedUserResult.response.value
        .map((flow: AnyRecord) => normalizeFlowCatalogItem(session, flow, 'shared-user'))
        .filter((flow): flow is FlowCatalogItem => Boolean(flow))
    : [];

  const baseFlowIds = new Set(baseFlows.map((flow) => flow.flowId));
  const sharedUserFlowIds = new Set(sharedUserFlows.map((flow) => flow.flowId));
  const portalSharedExtras = Array.isArray(portalSharedResult.response?.value)
    ? portalSharedResult.response.value
        .map((flow: AnyRecord) => normalizeFlowCatalogItem(session, flow, 'portal-shared'))
        .filter((flow): flow is FlowCatalogItem => {
          if (!flow) {
            return false;
          }

          return !baseFlowIds.has(flow.flowId) && !sharedUserFlowIds.has(flow.flowId);
        })
    : [];

  const flows = mergeCatalogItems(baseFlows, sharedUserFlows, portalSharedExtras);

  const catalog: FlowCatalog = {
    capturedAt: new Date().toISOString(),
    envId: session.envId,
    flows,
    source: portalSharedResult.source || sharedUserResult.source || baseResult.source || 'legacy-api',
  };

  await saveFlowCatalog(catalog);
  return catalog;
};

export const getStatus = () => {
  const session = getSession();
  const legacySession = session ? getPreferredLegacySession(session) : null;
  const activeTarget = session ? resolveTarget(session) : null;
  const currentTabFlowName = session ? resolveCurrentTabFlowName(session) : null;

  if (!session) {
    return {
      connected: false,
      message: 'Open or refresh a flow in Power Automate with the extension enabled to capture a session.',
    };
  }

  return {
    activeTarget: activeTarget
      ? {
          ...activeTarget,
          displayName: activeTarget.displayName,
        }
      : null,
    capturedAt: session.capturedAt,
    connected: true,
    currentTabFlowId: session.flowId || null,
    currentTabFlowName,
    envId: session.envId,
    flowId: activeTarget?.flowId || session.flowId,
    hasLegacyApi: Boolean(legacySession),
    legacySource: legacySession?.source || null,
    portalUrl: session.portalUrl || null,
  };
};

const fetchCurrentNormalizedFlow = async (session: TargetSession) => {
  try {
    const flowResponse = await fetchRawFlowModern(session);
    return normalizeFlow(session, flowResponse);
  } catch {
    try {
      const legacyFlowResponse = await fetchRawFlowLegacy(session);
      return normalizeLegacyFlow(session, legacyFlowResponse);
    } catch (legacyError) {
      const snapshot = getFlowSnapshotForFlow({ envId: session.envId, flowId: session.flowId }) || getFlowSnapshot();

      if (snapshot && snapshot.flowId === session.flowId && snapshot.envId === session.envId) {
        return normalizeSnapshot(snapshot);
      }

      throw legacyError;
    }
  }
};

const buildProposedFlow = ({
  before,
  displayName,
  flow,
}: {
  before: NormalizedFlow;
  displayName?: string;
  flow: FlowContent;
}): NormalizedFlow => ({
  ...before,
  displayName: displayName || before.displayName || '',
  flow: {
    $schema: before.flow.$schema || editorSchema,
    connectionReferences: flow.connectionReferences,
    definition: flow.definition,
  },
});

export const getCurrentFlow = async ({ target }: { target?: TargetRef } = {}) => {
  const session = ensureTargetSession(target);
  return fetchCurrentNormalizedFlow(session);
};

export const refreshFlows = async () => {
  const session = ensureSession();
  return listFlowsLegacy(session);
};

export const listFlows = async ({ limit = 100, query }: ListFlowsInput = {}) => {
  const session = ensureSession();
  try {
    const freshCatalog = await listFlowsLegacy(session);
    return filterCatalogFlows(freshCatalog, { limit, query });
  } catch (error) {
    const cachedCatalog = getFlowCatalogForEnv(session.envId);

    if (cachedCatalog) {
      return {
        ...filterCatalogFlows(cachedCatalog, { limit, query }),
        message:
          'Returned cached flow catalog because the live refresh failed. Refresh the Power Automate session if the list looks stale.',
      };
    }

    throw error;
  }
};

export const setActiveFlow = async ({
  flowId,
  selectionSource = 'manual',
}: {
  flowId: string;
  selectionSource?: 'clone-result' | 'create-result' | 'manual' | 'tab-capture';
}) => {
  const session = ensureSession();
  const catalog = getFlowCatalogForEnv(session.envId) || (await listFlowsLegacy(session));
  const matchingFlow = catalog.flows.find((flow) => flow.flowId === flowId);

  if (!matchingFlow) {
    throw new PowerAutomateSessionError({
      code: 'FLOW_NOT_FOUND',
      message: `The flow ${flowId} was not found in the current environment catalog. Refresh flows and try again.`,
    });
  }

  const target = await saveActiveTarget({
    displayName: matchingFlow.displayName,
    envId: session.envId,
    flowId,
    selectedAt: new Date().toISOString(),
    selectionSource,
  });

  return {
    activeTarget: target,
    flow: matchingFlow,
  };
};

export const selectFlow = (input: { flowId: string }) => setActiveFlow(input);

export const setActiveFlowFromTab = async () => {
  const session = ensureSession();

  if (!session.flowId) {
    throw new PowerAutomateSessionError({
      code: 'NO_TARGET',
      message: 'No flow is associated with the current browser tab yet.',
    });
  }

  if (!getFlowCatalogForEnv(session.envId)) {
    await listFlowsLegacy(session);
  }

  return setActiveFlow({
    flowId: session.flowId,
    selectionSource: 'tab-capture',
  });
};

export const selectTabFlow = () => setActiveFlowFromTab();

export const getActiveFlow = async () => {
  const session = ensureSession();
  const target = resolveTarget(session);

  if (!target) {
    return {
      activeTarget: null,
    };
  }

  const catalog = getFlowCatalogForEnv(session.envId) || (await listFlowsLegacy(session));
  const matchingFlow = catalog.flows.find((flow) => flow.flowId === target.flowId) || null;

  return {
    activeTarget: {
      ...target,
      displayName: matchingFlow?.displayName || target.displayName,
    },
    currentTab: {
      displayName: resolveCurrentTabFlowName(session),
      envId: session.envId,
      flowId: session.flowId || null,
    },
  };
};

const persistLastUpdate = async ({ after, before }: { after: NormalizedFlow; before: NormalizedFlow }) => {
  const lastUpdate = createLastUpdateRecord({ after, before });
  await saveLastUpdate(lastUpdate);
  return lastUpdate;
};

export const previewFlowUpdate = async ({ displayName, flow, target }: UpdateFlowInput) => {
  const session = ensureTargetSession(target);
  const before = await fetchCurrentNormalizedFlow(session);
  const after = buildProposedFlow({ before, displayName, flow });

  return {
    lastUpdate: createLastUpdateRecord({ after, before }),
    target: {
      displayName: session.targetDisplayName,
      envId: session.envId,
      flowId: session.flowId,
    },
  };
};

const updateCurrentFlowModern = async (session: TargetSession, { displayName, flow }: UpdateFlowInput) => {
  const before = normalizeFlow(session, await fetchRawFlowModern(session));
  const currentProperties = {
    connectionReferences: before.flow.connectionReferences,
    definition: before.flow.definition,
    displayName: before.displayName,
    environment: before.environment,
  };

  const updatedFlow = await requestJson<AnyRecord>({
    apiVersion: MODERN_API_VERSION,
    baseUrl: session.apiUrl,
    body: {
      properties: {
        connectionReferences: flow.connectionReferences,
        definition: flow.definition,
        displayName: displayName || currentProperties.displayName || '',
        environment: currentProperties.environment ?? null,
      },
    },
    method: 'PATCH',
    resourcePath: getCurrentFlowResourcePath(session.flowId),
    token: session.apiToken,
  });

  const after = normalizeFlow(session, updatedFlow);
  const lastUpdate = await persistLastUpdate({ after, before });
  return {
    flow: after,
    lastUpdate,
  };
};

const updateCurrentFlowLegacy = async (session: TargetSession, { displayName, flow }: UpdateFlowInput) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  const before = normalizeLegacyFlow(session, await fetchRawFlowLegacy(session));
  const currentProperties = {
    connectionReferences: before.flow.connectionReferences,
    definition: before.flow.definition,
    displayName: before.displayName,
    environment: before.environment,
  };

  const updatedFlow = await requestJson<AnyRecord>({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    body: {
      properties: {
        connectionReferences: flow.connectionReferences,
        definition: flow.definition,
        displayName: displayName || currentProperties.displayName || '',
        environment: currentProperties.environment ?? null,
      },
    },
    method: 'PATCH',
    resourcePath: getLegacyFlowBasePath(session.envId, session.flowId),
    token: legacySession.token,
  });

  const after = normalizeLegacyFlow(session, updatedFlow);
  const lastUpdate = await persistLastUpdate({ after, before });
  return {
    flow: after,
    lastUpdate,
  };
};

export const applyFlowUpdate = async ({ displayName, flow, target }: UpdateFlowInput) => {
  const session = ensureTargetSession(target);

  try {
    return await updateCurrentFlowModern(session, { displayName, flow });
  } catch {
    return updateCurrentFlowLegacy(session, { displayName, flow });
  }
};

export const updateCurrentFlow = async (input: UpdateFlowInput) => {
  const result = await applyFlowUpdate(input);
  return result.flow;
};

const buildBlankRequestDefinition = () => ({
  $schema:
    'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  actions: {
    Response: {
      inputs: {
        body: {
          ok: true,
        },
        statusCode: 200,
      },
      kind: 'Http',
      runAfter: {},
      type: 'Response',
    },
  },
  contentVersion: '1.0.0.0',
  outputs: {},
  parameters: {
    $authentication: {
      defaultValue: {},
      type: 'SecureObject',
    },
  },
  triggers: {
    manual: {
      inputs: {
        schema: {
          properties: {},
          type: 'object',
        },
      },
      kind: 'Http',
      type: 'Request',
    },
  },
});

const buildBlankRecurrenceDefinition = () => ({
  $schema:
    'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  actions: {
    Compose: {
      inputs: 'Scheduled run completed.',
      runAfter: {},
      type: 'Compose',
    },
  },
  contentVersion: '1.0.0.0',
  outputs: {},
  parameters: {
    $authentication: {
      defaultValue: {},
      type: 'SecureObject',
    },
  },
  triggers: {
    Recurrence: {
      recurrence: {
        frequency: 'Day',
        interval: 1,
      },
      type: 'Recurrence',
    },
  },
});

const createFlowLegacy = async (session: Session, { displayName, flow }: { displayName: string; flow: FlowContent }) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  const createdFlow = await requestJson<AnyRecord>({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    body: {
      properties: {
        connectionReferences: flow.connectionReferences,
        definition: flow.definition,
        displayName,
      },
    },
    method: 'POST',
    resourcePath: getLegacyFlowsCollectionPath(session.envId),
    token: legacySession.token,
  });

  const createdFlowId = createdFlow?.name || extractNameFromId(createdFlow?.id);

  if (!createdFlowId) {
    throw new Error('The create flow response did not include a flow ID.');
  }

  return normalizeLegacyFlow(
    {
      ...session,
      flowId: createdFlowId,
    },
    createdFlow,
  );
};

export const createFlow = async ({ displayName, triggerType = 'request' }: CreateFlowInput) => {
  const session = ensureSession();
  const flow = {
    connectionReferences: {},
    definition: triggerType === 'recurrence' ? buildBlankRecurrenceDefinition() : buildBlankRequestDefinition(),
  };
  const created = await createFlowLegacy(session, { displayName, flow });
  const activeTarget = await saveActiveTarget({
    displayName: created.displayName,
    envId: created.envId,
    flowId: created.flowId,
    selectedAt: new Date().toISOString(),
    selectionSource: 'create-result',
  });
  await listFlowsLegacy(session);

  return {
    activeTarget,
    flow: created,
  };
};

export const cloneFlow = async ({ displayName, makeActive = true, sourceFlowId }: CloneFlowInput) => {
  const session = ensureSession();
  const sourceResponse = await fetchRawFlowLegacy(
    {
      ...session,
      flowId: sourceFlowId,
    },
    sourceFlowId,
  );
  const source = normalizeLegacyFlow(
    {
      ...session,
      flowId: sourceFlowId,
    },
    sourceResponse,
  );
  const cloned = await createFlowLegacy(session, {
    displayName: displayName || `${source.displayName} Copy`,
    flow: source.flow,
  });

  let activeTarget = getActiveTarget();

  if (makeActive) {
    activeTarget = await saveActiveTarget({
      displayName: cloned.displayName,
      envId: cloned.envId,
      flowId: cloned.flowId,
      selectedAt: new Date().toISOString(),
      selectionSource: 'clone-result',
    });
  }

  await listFlowsLegacy(session);

  return {
    activeTarget,
    flow: cloned,
    sourceFlowId,
  };
};

export const getLastUpdateSummary = (): LastUpdate | null => {
  const session = getSession();

  if (!session) {
    return getLastUpdate();
  }

  const target = getActiveOrTabTarget(session);
  return target ? getLastUpdateForFlow(target) || getLastUpdate() : getLastUpdate();
};

const createCapabilityStatus = ({
  available,
  reason,
  reasonCode,
}: {
  available: boolean;
  reason?: string | null;
  reasonCode?: CapabilityReasonCode | null;
}): CapabilityStatus => ({
  available,
  reason: available ? null : (reason ?? null),
  reasonCode: available ? null : (reasonCode ?? null),
});

export const getLastRunSummary = (): LastRun | null => {
  const session = getSession();

  if (!session) {
    return getLastRun();
  }

  const target = getActiveOrTabTarget(session);
  return target ? getLastRunForFlow(target) || getLastRun() : getLastRun();
};

export const getContext = ({ bridgeMode = 'owned' }: { bridgeMode?: BridgeMode } = {}): PowerAutomateContext => {
  const session = getSession();
  const legacySession = session ? getPreferredLegacySession(session) : null;
  const resolvedTarget = session ? resolveTarget(session) : null;
  const activeTarget =
    session && getActiveTarget()?.envId === session.envId ? getActiveTarget() : null;
  const currentTab =
    session ?
      {
        displayName: resolveCurrentTabFlowName(session),
        envId: session.envId,
        flowId: session.flowId || null,
      }
    : null;
  const storeHealthItems = getStoreDiagnostics();
  const hasStoreCorruption = storeHealthItems.some((item) => item.state === 'corrupted');

  const noSessionReason = hasStoreCorruption ? 'One or more local state files are corrupted. Reopen the flow or clear local state.' : 'Open or refresh a Power Automate flow so the extension can capture a session.';
  const noSessionCode: CapabilityReasonCode = hasStoreCorruption ? 'STORE_CORRUPTED' : 'NO_SESSION';
  const noTargetReason = 'Select a flow or sync the current browser tab before running target-specific actions.';

  return {
    capabilities: {
      canReadFlow: createCapabilityStatus(
        session && resolvedTarget ?
          { available: true }
        : { available: false, reason: !session ? noSessionReason : noTargetReason, reasonCode: !session ? noSessionCode : 'NO_TARGET' },
      ),
      canReadFlows: createCapabilityStatus(
        session ?
          { available: true }
        : { available: false, reason: noSessionReason, reasonCode: noSessionCode },
      ),
      canReadRuns: createCapabilityStatus(
        session && resolvedTarget && legacySession ?
          { available: true }
        : {
            available: false,
            reason:
              !session ? noSessionReason
              : !resolvedTarget ? noTargetReason
              : 'Refresh the flow page again to capture a legacy-compatible token before inspecting runs.',
            reasonCode:
              !session ? noSessionCode
              : !resolvedTarget ? 'NO_TARGET'
              : 'LEGACY_TOKEN_MISSING',
          },
      ),
      canUpdateFlow: createCapabilityStatus(
        session && resolvedTarget ?
          { available: true }
        : { available: false, reason: !session ? noSessionReason : noTargetReason, reasonCode: !session ? noSessionCode : 'NO_TARGET' },
      ),
      canUseLegacyApi: createCapabilityStatus(
        session && legacySession ?
          { available: true }
        : {
            available: false,
            reason: !session ? noSessionReason : 'Refresh the flow page again to capture a legacy-compatible token.',
            reasonCode: !session ? noSessionCode : 'LEGACY_TOKEN_MISSING',
          },
      ),
      canValidateFlow: createCapabilityStatus(
        session && resolvedTarget && legacySession ?
          { available: true }
        : {
            available: false,
            reason:
              !session ? noSessionReason
              : !resolvedTarget ? noTargetReason
              : 'Refresh the flow page again to capture a legacy-compatible token before validating.',
            reasonCode:
              !session ? noSessionCode
              : !resolvedTarget ? 'NO_TARGET'
              : 'LEGACY_TOKEN_MISSING',
          },
      ),
    },
    diagnostics: {
      bridgeMode,
      envId: session?.envId || resolvedTarget?.envId || null,
      lastRunCapturedAt: getLastRunSummary()?.capturedAt || null,
      lastUpdateCapturedAt: getLastUpdateSummary()?.capturedAt || null,
      legacySource: legacySession?.source || null,
      snapshotCapturedAt: getFlowSnapshot()?.capturedAt || null,
      storeHealth: {
        items: storeHealthItems,
        ok: !hasStoreCorruption,
      },
      tokenAuditCapturedAt: getTokenAudit()?.capturedAt || null,
    },
    selection: {
      activeTarget: activeTarget ? { ...activeTarget, displayName: resolveFlowDisplayName(activeTarget) } : null,
      currentTab,
      resolvedTarget,
    },
    session: {
      capturedAt: session?.capturedAt || null,
      connected: Boolean(session),
      envId: session?.envId || null,
      flowId: session?.flowId || null,
      portalUrl: session?.portalUrl || null,
    },
  };
};

export const getContextPayload = ({ bridgeMode = 'owned' }: { bridgeMode?: BridgeMode } = {}): ContextPayload => ({
  context: getContext({ bridgeMode }),
  lastRun: getLastRunSummary(),
  lastUpdate: getLastUpdateSummary(),
  ok: true,
});

export const revertLastUpdate = async ({ target }: { target?: TargetRef } = {}) => {
  const session = ensureTargetSession(target);
  const lastUpdate = getLastUpdateForFlow(session) || getLastUpdate();

  if (!lastUpdate) {
    throw new PowerAutomateSessionError({
      code: 'NO_TARGET',
      message: 'No previous update is available to revert.',
    });
  }

  if (lastUpdate.flowId !== session.flowId || lastUpdate.envId !== session.envId) {
    throw new PowerAutomateSessionError({
      code: 'TARGET_MISMATCH',
      message: 'The active flow does not match the last updated flow. Open the same flow before reverting.',
    });
  }

  return applyFlowUpdate({
    displayName: lastUpdate.before.displayName,
    flow: lastUpdate.before.flow,
    target: {
      envId: session.envId,
      flowId: session.flowId,
    },
  });
};

const normalizeRun = (session: TargetSession, run: AnyRecord): RunSummary => {
  const properties = run?.properties || {};

  return {
    endTime:
      properties.endTime || properties.endTimeUtc || properties.endTimeStamp || properties.endTimeStampUtc || null,
    errorMessage:
      properties.error?.message ||
      properties.outputsLink?.error?.message ||
      properties.statusMessage ||
      null,
    failedActionName: null,
    flowId: session.flowId,
    runId: run?.name || properties.runName || extractNameFromId(run?.id) || 'unknown-run',
    startTime:
      properties.startTime || properties.startTimeUtc || properties.startTimeStamp || properties.startTimeStampUtc || null,
    status: properties.status || properties.state || null,
    triggerName:
      properties.trigger?.name ||
      properties.triggerName ||
      extractNameFromId(properties.trigger?.id) ||
      extractNameFromId(run?.id?.split('/runs/')[0]) ||
      null,
  };
};

const normalizeRunAction = (action: AnyRecord): RunActionSummary => {
  const properties = action?.properties || {};
  const status = properties.status || properties.state || null;
  const normalizedStatus = (status || '').toLowerCase();
  const rawErrorMessage =
    properties.error?.message ||
    properties.outputsLink?.error?.message ||
    properties.statusMessage ||
    null;

  return {
    code: properties.code || null,
    endTime:
      properties.endTime || properties.endTimeUtc || properties.endTimeStamp || properties.endTimeStampUtc || null,
    errorMessage: normalizedStatus === 'skipped' ? null : rawErrorMessage,
    name: action?.name || extractNameFromId(action?.id),
    startTime:
      properties.startTime || properties.startTimeUtc || properties.startTimeStamp || properties.startTimeStampUtc || null,
    status,
    type: properties.type || action?.type || null,
  };
};

const listRunsLegacy = async (session: TargetSession, { limit = 10 }: ListRunsInput = {}) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  const response = await requestJson<AnyRecord>({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: `${getLegacyFlowBasePath(session.envId, session.flowId)}/runs`,
    token: legacySession.token,
  });

  const runs = Array.isArray(response?.value) ? response.value : [];

  return {
    runs: runs.slice(0, limit).map((run: AnyRecord) => normalizeRun(session, run)),
    source: legacySession.source,
  };
};

const getRunLegacy = async (session: TargetSession, runId: string) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  const run = await requestJson<AnyRecord>({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: `${getLegacyFlowBasePath(session.envId, session.flowId)}/runs/${runId}`,
    token: legacySession.token,
  });

  return {
    run: normalizeRun(session, run),
    source: legacySession.source,
  };
};

const getRunActionsLegacy = async (session: TargetSession, runId: string) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  const response = await requestJson<AnyRecord>({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: `${getLegacyFlowBasePath(session.envId, session.flowId)}/runs/${runId}/actions`,
    token: legacySession.token,
  });

  const actions = Array.isArray(response?.value) ? response.value : [];

  return {
    actions: actions.map((action: AnyRecord) => normalizeRunAction(action)),
    source: legacySession.source,
  };
};

const getCurrentTriggerName = async (target?: TargetRef) => {
  const flow = await getCurrentFlow({ target });
  const triggerNames = Object.keys(flow.flow.definition.triggers || {});
  const triggerName = triggerNames[0] || null;

  if (!triggerName) {
    throw new PowerAutomateSessionError({
      code: 'TRIGGER_NOT_FOUND',
      message: 'No trigger was found in the current flow definition.',
    });
  }

  return triggerName;
};

export const validateCurrentFlow = async ({ flow, target }: ValidateFlowInput) => {
  const session = ensureTargetSession(target);
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    return {
      available: false,
      message:
        'Legacy validation is not available yet. Refresh the flow page again to capture a flow-compatible token.',
    };
  }

  const legacyBasePath = getLegacyFlowBasePath(session.envId, session.flowId);
  const requestBody = {
    properties: {
      definition: flow.definition,
    },
  };

  const [errors, warnings] = await Promise.all([
    requestJson({
      apiVersion: LEGACY_API_VERSION,
      baseUrl: legacySession.baseUrl,
      body: requestBody,
      method: 'POST',
      resourcePath: `${legacyBasePath}/checkFlowErrors`,
      token: legacySession.token,
    }),
    requestJson({
      apiVersion: LEGACY_API_VERSION,
      baseUrl: legacySession.baseUrl,
      body: requestBody,
      method: 'POST',
      resourcePath: `${legacyBasePath}/checkFlowWarnings`,
      token: legacySession.token,
    }),
  ]);

  return {
    available: true,
    errors: normalizeIssues(errors),
    source: legacySession.source,
    warnings: normalizeIssues(warnings),
  };
};

export const listRuns = async ({ limit = 10, target }: ListRunsInput = {}) => {
  const session = ensureTargetSession(target);
  return listRunsLegacy(session, { limit });
};

export const getRun = async ({ runId, target }: { runId: string; target?: TargetRef }) => {
  const session = ensureTargetSession(target);
  const [{ actions, source }, { run }] = await Promise.all([
    getRunActionsLegacy(session, runId),
    getRunLegacy(session, runId),
  ]);

  return {
    run: withFailedAction(run, actions),
    source,
  };
};

export const getRunActions = async ({ runId, target }: { runId: string; target?: TargetRef }) => {
  const session = ensureTargetSession(target);
  return getRunActionsLegacy(session, runId);
};

export const getLatestRun = async ({ target }: { target?: TargetRef } = {}) => {
  const session = ensureTargetSession(target);
  const { runs, source } = await listRunsLegacy(session, { limit: 1 });
  let run = runs[0] || null;

  if (run?.runId) {
    const detail = await getRun({
      runId: run.runId,
      target: {
        envId: session.envId,
        flowId: session.flowId,
      },
    });
    run = detail.run;
  }

  return {
    run,
    source,
  };
};

export const refreshLatestRun = async ({ target }: { target?: TargetRef } = {}): Promise<LastRun> => {
  const session = ensureTargetSession(target);
  const latest = await getLatestRun({
    target: {
      envId: session.envId,
      flowId: session.flowId,
    },
  });

  const payload: LastRun = {
    capturedAt: new Date().toISOString(),
    envId: session.envId,
    flowId: session.flowId,
    run: latest.run,
  };

  await saveLastRun(payload);
  return payload;
};

export const waitForRun = async ({
  pollIntervalSeconds = 5,
  runId,
  target,
  timeoutSeconds = 60,
}: WaitForRunInput = {}) => {
  const session = ensureTargetSession(target);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let targetRunId = runId || null;

  while (Date.now() <= deadline) {
    if (!targetRunId) {
      const latest = await getLatestRun({
        target: {
          envId: session.envId,
          flowId: session.flowId,
        },
      });
      targetRunId = latest.run?.runId || null;

      if (!targetRunId) {
        await sleep(pollIntervalSeconds * 1000);
        continue;
      }
    }

    const detail = await getRun({
      runId: targetRunId,
      target: {
        envId: session.envId,
        flowId: session.flowId,
      },
    });
    const status = (detail.run?.status || '').toLowerCase();

    if (TERMINAL_RUN_STATUSES.has(status)) {
      await saveLastRun({
        capturedAt: new Date().toISOString(),
        envId: session.envId,
        flowId: session.flowId,
        run: detail.run,
      });
      return {
        completed: true,
        run: detail.run,
        source: detail.source,
      };
    }

    await sleep(pollIntervalSeconds * 1000);
  }

  return {
    completed: false,
    message: 'Timed out while waiting for the run to finish.',
    runId: targetRunId || null,
  };
};

export const getTriggerCallbackUrl = async ({ triggerName, target }: TriggerCallbackInput = {}) => {
  const session = ensureTargetSession(target);
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError({
      code: 'LEGACY_TOKEN_MISSING',
      message: 'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    });
  }

  const effectiveTriggerName = triggerName || (await getCurrentTriggerName(target));
  const response = await requestJson<AnyRecord>({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    body: {},
    method: 'POST',
    resourcePath: `${getLegacyFlowBasePath(session.envId, session.flowId)}/triggers/${effectiveTriggerName}/listCallbackUrl`,
    token: legacySession.token,
  });

  const callback = response.response || response;

  return {
    basePath: callback.basePath || null,
    method: callback.method || 'POST',
    queries: callback.queries || null,
    source: legacySession.source,
    triggerName: effectiveTriggerName,
    url: callback.value || callback.callbackUrl || callback.url || null,
  };
};

export const invokeTrigger = async ({
  body = {},
  target,
  triggerName,
}: {
  body?: unknown;
  target?: TargetRef;
  triggerName?: string;
} = {}) => {
  const callback = await getTriggerCallbackUrl({ target, triggerName });

  if (!callback.url) {
    throw new PowerAutomateSessionError({
      code: 'CALLBACK_URL_MISSING',
      message: 'The trigger callback URL is missing or invalid.',
    });
  }

  const response = await fetch(callback.url, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    method: callback.method || 'POST',
  });

  const responseText = await response.text();
  let parsedBody: unknown = responseText;

  try {
    parsedBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    // Keep raw text if the callback did not return JSON.
  }

  return {
    body: parsedBody,
    headers: {
      contentType: response.headers.get('content-type'),
      runId:
        response.headers.get('x-ms-workflow-run-id') ||
        response.headers.get('x-ms-client-tracking-id') ||
        null,
    },
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    triggerName: callback.triggerName,
  };
};
