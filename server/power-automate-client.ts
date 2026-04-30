import { getActiveTarget, saveActiveTarget } from './active-target-store.js';
import type {
  BridgeMode,
  CapabilityReasonCode,
  CapabilityStatus,
  CapturedSessionSummary,
  ContextPayload,
  PowerAutomateContext,
} from './bridge-types.js';
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
import { getLatestCaptureDiagnostic, getLatestCaptureDiagnosticForFlow } from './capture-diagnostics-store.js';
import { getCapturedSession, listCapturedSessions } from './captured-sessions-store.js';
import { getFlowCatalogForEnv, saveFlowCatalog } from './flow-catalog-store.js';
import { getFlowSnapshot, getFlowSnapshotForFlow } from './flow-snapshot-store.js';
import { getLastRun, getLastRunForFlow, saveLastRun } from './last-run-store.js';
import type {
  ActiveTarget,
  CapturedSession,
  CloneFlowInput,
  ConnectFlowInput,
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
import { PowerAutomateError, PowerAutomateSessionError, toPowerAutomateApiError } from './errors.js';
import { getSession } from './session-store.js';
import { getSelectedWorkTab, saveSelectedWorkTab } from './selected-work-tab-store.js';
import { getStoreDiagnostics } from './store-utils.js';
import { getTokenAudit } from './token-audit-store.js';
import { decodeJwtPayload, hasLegacyCompatibleToken } from './token-compat.js';
import { getLastUpdate, getLastUpdateForFlow, saveLastUpdate } from './update-history-store.js';

const MODERN_API_VERSION = '1';
const LEGACY_API_VERSION = '2016-11-01';
const LEGACY_FLOW_BASE_URL = 'https://api.flow.microsoft.com/';
const FLOW_SERVICE_TOKEN_MISSING_MESSAGE =
  'No flow-compatible token is available yet. Focus or reopen the flow page so the extension can capture a flow-service token.';

const normalizeAudience = (audience: unknown) =>
  typeof audience === 'string' ? audience.replace(/\/+$/, '').toLowerCase() : '';

const getLatestCaptureDiagnosticForTarget = (target?: { envId: string; flowId: string }) =>
  target ? getLatestCaptureDiagnosticForFlow(target) || getLatestCaptureDiagnostic() : getLatestCaptureDiagnostic();

const createFlowServiceTokenMissingError = (target?: { envId: string; flowId: string }) =>
  new PowerAutomateSessionError({
    code: 'LEGACY_TOKEN_MISSING',
    details: {
      latestCaptureDiagnostic: getLatestCaptureDiagnosticForTarget(target),
    },
    message: FLOW_SERVICE_TOKEN_MISSING_MESSAGE,
  });

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

const isTokenExpired = (authorization: string | null | undefined) => {
  const tokenPayload = decodeJwtPayload(authorization) as { exp?: unknown } | null;
  return typeof tokenPayload?.exp === 'number' ? tokenPayload.exp * 1000 <= Date.now() : false;
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
      message: 'No active browser session found. Open or focus the target flow in Power Automate with the extension enabled.',
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
  const activeTarget = getActiveTarget(session.envId);

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

const summarizeCapturedSession = (session: CapturedSession): CapturedSessionSummary => ({
  capturedAt: session.capturedAt,
  displayName: resolveFlowDisplayName({
    envId: session.envId,
    flowId: session.flowId,
  }),
  envId: session.envId,
  flowId: session.flowId,
  hasLegacyApi: Boolean(session.legacyApiUrl && session.legacyToken) || hasLegacyCompatibleToken(session.apiToken),
  isSelected: getSelectedWorkTab()?.tabId === session.tabId,
  lastSeenAt: session.lastSeenAt,
  portalUrl: session.portalUrl || null,
  tabId: session.tabId,
});

export const listCapturedTabs = () => listCapturedSessions().map(summarizeCapturedSession);

export const selectWorkTab = async ({ tabId }: { tabId: number }) => {
  const session = getCapturedSession(tabId);

  if (!session) {
    throw new PowerAutomateSessionError({
      code: 'NO_SESSION',
      message: `No captured browser session is stored for tab ${tabId}.`,
    });
  }

  await saveSelectedWorkTab({
    selectedAt: new Date().toISOString(),
    tabId,
  });

  if (!getActiveTarget(session.envId)) {
    await saveActiveTarget({
      displayName: null,
      envId: session.envId,
      flowId: session.flowId,
      selectedAt: new Date().toISOString(),
      selectionSource: 'tab-capture',
    });
  }

  return {
    selectedWorkSession: summarizeCapturedSession(session),
  };
};

const ensureTargetSession = (target?: TargetRef): TargetSession => {
  const session = ensureSession();
  const resolvedTarget = resolveTarget(session, target);

  if (!resolvedTarget?.flowId) {
    throw new PowerAutomateSessionError({
      code: 'NO_TARGET',
      message:
        'No active flow target is selected. Use connect_flow, or focus a captured Power Automate flow tab first.',
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
  const parsedBody = body as AnyRecord | string | null;
  const message =
    (parsedBody as AnyRecord | null)?.error?.message ||
    (parsedBody as AnyRecord | null)?.message ||
    (typeof parsedBody === 'string' && parsedBody) ||
    `Power Automate API request failed with ${response.status} ${response.statusText}.`;

  return toPowerAutomateApiError({
    body,
    fallbackMessage: message,
    status: response.status,
    statusText: response.statusText,
  });
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
  if (session.legacyApiUrl && session.legacyToken && !isTokenExpired(session.legacyToken)) {
    return {
      baseUrl: session.legacyApiUrl,
      source: 'captured-flow-service-session',
      token: session.legacyToken,
    };
  }

  if (hasLegacyCompatibleToken(session.apiToken) && !isTokenExpired(session.apiToken)) {
    return {
      baseUrl: LEGACY_FLOW_BASE_URL,
      source: 'captured-flow-service-compatible-session',
      token: session.apiToken,
    };
  }

  const tokenAudit = getTokenAudit();
  const preferredToken =
    tokenAudit?.candidates?.find((candidate) => normalizeAudience(candidate.aud) === 'https://service.flow.microsoft.com') ||
    tokenAudit?.candidates?.find((candidate) => normalizeAudience(candidate.aud) === 'https://service.powerapps.com');

  if (!preferredToken) return null;

  if (isTokenExpired(preferredToken.token)) {
    throw new PowerAutomateSessionError({
      code: 'TOKEN_EXPIRED',
      details: {
        source: preferredToken.source,
      },
      message: 'The captured flow-service token is expired. Reopen or focus the flow page so the extension can capture a fresh token.',
      retryable: true,
    });
  }

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

const catalogItemFromKnownFlow = ({
  accessScope = 'owned',
  displayName,
  envId,
  flowId,
  source,
}: {
  accessScope?: FlowCatalogItem['accessScope'];
  displayName?: string | null;
  envId: string;
  flowId: string;
  source: 'active-target' | 'captured-tab' | 'snapshot';
}): FlowCatalogItem => ({
  accessScope,
  actionTypes: [],
  createdTime: null,
  creatorObjectId: null,
  displayName: displayName || resolveFlowDisplayName({ envId, flowId }) || `Flow ${flowId.slice(0, 8)}`,
  envId,
  flowId,
  lastModifiedTime: null,
  sharingType: source,
  state: null,
  triggerTypes: [],
  userType: null,
});

const getKnownFlowCatalogItems = (envId: string): FlowCatalogItem[] => {
  const items: FlowCatalogItem[] = [];
  const seen = new Set<string>();
  const add = (item: FlowCatalogItem | null) => {
    if (!item || item.envId !== envId || seen.has(item.flowId)) return;
    seen.add(item.flowId);
    items.push(item);
  };

  for (const capturedSession of listCapturedSessions()) {
    add(
      catalogItemFromKnownFlow({
        accessScope: 'owned',
        displayName: resolveFlowDisplayName(capturedSession),
        envId: capturedSession.envId,
        flowId: capturedSession.flowId,
        source: 'captured-tab',
      }),
    );
  }

  const snapshot = getFlowSnapshot();
  if (snapshot) {
    add(
      catalogItemFromKnownFlow({
        accessScope: 'owned',
        displayName: snapshot.displayName,
        envId: snapshot.envId,
        flowId: snapshot.flowId,
        source: 'snapshot',
      }),
    );
  }

  const activeTarget = getActiveTarget(envId);
  if (activeTarget) {
    add(
      catalogItemFromKnownFlow({
        accessScope: 'owned',
        displayName: activeTarget.displayName,
        envId: activeTarget.envId,
        flowId: activeTarget.flowId,
        source: 'active-target',
      }),
    );
  }

  return items;
};

const mergeCatalogWithKnownFlows = (catalog: FlowCatalog, envId = catalog.envId): FlowCatalog => ({
  ...catalog,
  flows: mergeCatalogItems(catalog.flows, getKnownFlowCatalogItems(envId)),
});

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
    throw createFlowServiceTokenMissingError(session);
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
    throw createFlowServiceTokenMissingError(session);
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

  const flows = mergeCatalogItems(baseFlows, sharedUserFlows, portalSharedExtras, getKnownFlowCatalogItems(session.envId));

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
  const selectedWorkTab = getSelectedWorkTab();
  const capturedSessions = listCapturedTabs();
  const currentTabFlowName = session ? resolveCurrentTabFlowName(session) : null;

  if (!session) {
    return {
      connected: false,
      message:
        capturedSessions.length > 0 ?
          'A captured session exists, but no work tab is selected. Select a work tab before continuing.'
        : 'Open or refresh a flow in Power Automate with the extension enabled to capture a session.',
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
    selectedWorkTabId: selectedWorkTab?.tabId || null,
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
        ...filterCatalogFlows(mergeCatalogWithKnownFlows(cachedCatalog, session.envId), { limit, query }),
        message:
          'Returned cached and browser-captured flows because the live refresh failed. Focus the target flow page if the list looks stale.',
      };
    }

    const knownFlows = getKnownFlowCatalogItems(session.envId);
    if (knownFlows.length > 0) {
      return filterCatalogFlows(
        {
          capturedAt: new Date().toISOString(),
          envId: session.envId,
          flows: knownFlows,
          source: 'browser-capture',
        },
        { limit, query },
      );
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
  const catalog = mergeCatalogWithKnownFlows(getFlowCatalogForEnv(session.envId) || (await listFlowsLegacy(session)), session.envId);
  const matchingFlow = catalog.flows.find((flow) => flow.flowId === flowId);

  if (!matchingFlow) {
    const target = await saveActiveTarget({
      displayName: resolveFlowDisplayName({ envId: session.envId, flowId }),
      envId: session.envId,
      flowId,
      selectedAt: new Date().toISOString(),
      selectionSource,
    });

    return {
      activeTarget: target,
      flow: catalogItemFromKnownFlow({
        displayName: target.displayName,
        envId: session.envId,
        flowId,
        source: 'active-target',
      }),
      message: 'Selected a browser-known flow that is not present in the refreshed catalog yet.',
    };
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

const connectCapturedSession = async (capturedSession: CapturedSession, selectionSource: ActiveTarget['selectionSource'] = 'tab-capture') => {
  await saveSelectedWorkTab({
    selectedAt: new Date().toISOString(),
    tabId: capturedSession.tabId,
  });

  const activeTarget = await saveActiveTarget({
    displayName: resolveFlowDisplayName(capturedSession),
    envId: capturedSession.envId,
    flowId: capturedSession.flowId,
    selectedAt: new Date().toISOString(),
    selectionSource,
  });

  return {
    activeTarget,
    connected: true,
    selectedWorkSession: summarizeCapturedSession(capturedSession),
  };
};

const getConnectCandidates = ({ envId, nameQuery }: { envId?: string; nameQuery?: string } = {}) => {
  const normalizedQuery = nameQuery?.trim().toLowerCase() || null;
  const byKey = new Map<string, FlowCatalogItem & { tabId?: number | null }>();

  const add = (flow: FlowCatalogItem & { tabId?: number | null }) => {
    if (envId && flow.envId !== envId) return;
    if (normalizedQuery && !flow.displayName.toLowerCase().includes(normalizedQuery) && !flow.flowId.includes(normalizedQuery)) return;
    byKey.set(`${flow.envId}:${flow.flowId}`, flow);
  };

  for (const capturedSession of listCapturedSessions()) {
    add({
      ...catalogItemFromKnownFlow({
        displayName: resolveFlowDisplayName(capturedSession),
        envId: capturedSession.envId,
        flowId: capturedSession.flowId,
        source: 'captured-tab',
      }),
      tabId: capturedSession.tabId,
    });
  }

  const session = getSession();
  const catalog = session ? getFlowCatalogForEnv(session.envId) : null;
  for (const flow of catalog?.flows || []) {
    add(flow);
  }

  const snapshot = getFlowSnapshot();
  if (snapshot) {
    add(
      catalogItemFromKnownFlow({
        displayName: snapshot.displayName,
        envId: snapshot.envId,
        flowId: snapshot.flowId,
        source: 'snapshot',
      }),
    );
  }

  return [...byKey.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
};

export const connectFlow = async ({ envId, flowId, nameQuery, tabId }: ConnectFlowInput) => {
  if (typeof tabId === 'number') {
    const capturedSession = getCapturedSession(tabId);

    if (!capturedSession) {
      throw new PowerAutomateSessionError({
        code: 'NO_SESSION',
        message: `No captured browser session is stored for tab ${tabId}.`,
      });
    }

    return connectCapturedSession(capturedSession);
  }

  const session = getSession();

  if (flowId) {
    const capturedSession = listCapturedSessions().find(
      (candidate) => candidate.flowId === flowId && (!envId || candidate.envId === envId),
    );

    if (capturedSession) {
      return connectCapturedSession(capturedSession);
    }

    const resolvedEnvId = envId || session?.envId;

    if (!resolvedEnvId) {
      throw new PowerAutomateSessionError({
        code: 'NO_SESSION',
        message: 'No browser session is available yet. Open a Power Automate flow once so the extension can capture the environment.',
      });
    }

    const activeTarget = await saveActiveTarget({
      displayName: resolveFlowDisplayName({ envId: resolvedEnvId, flowId }),
      envId: resolvedEnvId,
      flowId,
      selectedAt: new Date().toISOString(),
      selectionSource: 'manual',
    });

    return {
      activeTarget,
      connected: Boolean(session),
      message: session ? null : 'Saved the target, but browser-backed operations still need a captured session.',
    };
  }

  const candidates = getConnectCandidates({ envId, nameQuery });

  if (candidates.length === 1) {
    const [candidate] = candidates;
    const capturedSession = typeof candidate.tabId === 'number' ? getCapturedSession(candidate.tabId) : null;
    if (capturedSession) return connectCapturedSession(capturedSession);

    const activeTarget = await saveActiveTarget({
      displayName: candidate.displayName,
      envId: candidate.envId,
      flowId: candidate.flowId,
      selectedAt: new Date().toISOString(),
      selectionSource: 'manual',
    });

    return {
      activeTarget,
      connected: Boolean(session),
    };
  }

  if (candidates.length > 1) {
    return {
      candidates,
      connected: false,
      message: 'More than one flow matched. Call connect_flow again with flowId or tabId.',
      needsSelection: true,
    };
  }

  throw new PowerAutomateError({
    code: 'FLOW_NOT_FOUND',
    details: {
      envId: envId || null,
      nameQuery: nameQuery || null,
    },
    message: 'No captured or cataloged flow matched the requested target.',
    retryable: true,
  });
};

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
    throw createFlowServiceTokenMissingError(session);
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
    throw createFlowServiceTokenMissingError(session);
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

  let activeTarget = getActiveTarget(session.envId);

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
  const selectedWorkTab = getSelectedWorkTab();
  const selectedWorkSession = selectedWorkTab ? getCapturedSession(selectedWorkTab.tabId) : null;
  const capturedSessions = listCapturedTabs();
  const activeTarget =
    session && getActiveTarget(session.envId)?.envId === session.envId ? getActiveTarget(session.envId) : null;
  const currentTab =
    selectedWorkSession ?
      {
        displayName: summarizeCapturedSession(selectedWorkSession).displayName,
        envId: selectedWorkSession.envId,
        flowId: selectedWorkSession.flowId,
      }
    : null;
  const storeHealthItems = getStoreDiagnostics();
  const hasStoreCorruption = storeHealthItems.some((item) => item.state === 'corrupted');

  const noSessionReason =
    hasStoreCorruption ?
      'One or more local state files are corrupted. Reopen the flow or clear local state.'
    : capturedSessions.length > 0 ?
      'Select a work tab before running session-dependent actions.'
    : 'Open or focus a Power Automate flow so the extension can capture a session.';
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
              : 'Focus or reopen the flow page so the extension can capture a flow-service token before inspecting runs.',
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
            reason: !session ? noSessionReason : 'Focus or reopen the flow page so the extension can capture a flow-service token.',
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
              : 'Focus or reopen the flow page so the extension can capture a flow-service token before validating.',
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
      latestCaptureDiagnostic: getLatestCaptureDiagnosticForTarget(
        resolvedTarget?.envId && resolvedTarget.flowId ?
          {
            envId: resolvedTarget.envId,
            flowId: resolvedTarget.flowId,
          }
        : undefined,
      ),
      snapshotCapturedAt:
        resolvedTarget ? getFlowSnapshotForFlow(resolvedTarget)?.capturedAt || null : getFlowSnapshot()?.capturedAt || null,
      storeHealth: {
        items: storeHealthItems,
        ok: !hasStoreCorruption,
      },
      tokenAuditCapturedAt: getTokenAudit()?.capturedAt || null,
    },
    selection: {
      activeTarget: activeTarget ? { ...activeTarget, displayName: resolveFlowDisplayName(activeTarget) } : null,
      capturedSessions,
      currentTab,
      resolvedTarget,
      selectedWorkSession: selectedWorkSession ? summarizeCapturedSession(selectedWorkSession) : null,
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
    throw createFlowServiceTokenMissingError(session);
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
    throw createFlowServiceTokenMissingError(session);
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
    throw createFlowServiceTokenMissingError(session);
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
        'Flow-service validation is not available yet. Focus or reopen the flow page so the extension can capture a flow-compatible token.',
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
    throw createFlowServiceTokenMissingError(session);
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

