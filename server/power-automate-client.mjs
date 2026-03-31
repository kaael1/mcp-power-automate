import { getActiveTarget, saveActiveTarget } from './active-target-store.mjs';
import { getFlowCatalogForEnv, saveFlowCatalog } from './flow-catalog-store.mjs';
import { getFlowSnapshot, getFlowSnapshotForFlow } from './flow-snapshot-store.mjs';
import { getLastRun, getLastRunForFlow, saveLastRun } from './last-run-store.mjs';
import { getLastUpdate, getLastUpdateForFlow, saveLastUpdate } from './update-history-store.mjs';
import { editorSchema } from './schemas.mjs';
import { getSession } from './session-store.mjs';
import { getTokenAudit } from './token-audit-store.mjs';

const MODERN_API_VERSION = '1';
const LEGACY_API_VERSION = '2016-11-01';
const LEGACY_FLOW_BASE_URL = 'https://api.flow.microsoft.com/';
const TERMINAL_RUN_STATUSES = new Set(['cancelled', 'canceled', 'failed', 'skipped', 'succeeded', 'timedout']);

export class PowerAutomateSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PowerAutomateSessionError';
  }
}

const ensureSession = () => {
  const session = getSession();

  if (!session) {
    throw new PowerAutomateSessionError(
      'No active browser session found. Open or refresh the target flow in Power Automate with the extension enabled.',
    );
  }

  return session;
};

const createTabTargetFromSession = (session) => {
  if (!session?.flowId) return null;

  return {
    displayName: null,
    envId: session.envId,
    flowId: session.flowId,
    selectedAt: session.capturedAt,
    selectionSource: 'tab-capture',
  };
};

const getActiveOrTabTarget = (session) => {
  const activeTarget = getActiveTarget();

  if (activeTarget?.envId === session.envId) {
    return activeTarget;
  }

  return createTabTargetFromSession(session);
};

const ensureTargetSession = () => {
  const session = ensureSession();
  const target = getActiveOrTabTarget(session);

  if (!target?.flowId) {
    throw new PowerAutomateSessionError(
      'No active flow target is selected. Use list_flows and set_active_flow, or capture the current tab as the active target first.',
    );
  }

  return {
    ...session,
    flowId: target.flowId,
    targetDisplayName: target.displayName || null,
    targetSelectedAt: target.selectedAt,
    targetSelectionSource: target.selectionSource,
  };
};

const ensureTrailingSlash = (value) => (value.endsWith('/') ? value : `${value}/`);

const buildRequestUrl = (baseUrl, resourcePath, apiVersion) => {
  const url = new URL(resourcePath, ensureTrailingSlash(baseUrl));
  url.searchParams.set('api-version', apiVersion);
  return url;
};

const readResponseBody = async (response) => {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const toApiError = (response, body) => {
  if (response.status === 401 || response.status === 403) {
    return new PowerAutomateSessionError(
      'The captured Power Automate session is expired or invalid. Reopen or refresh the flow in the browser to capture a fresh token.',
    );
  }

  const message =
    body?.error?.message ||
    body?.message ||
    (typeof body === 'string' && body) ||
    `Power Automate API request failed with ${response.status} ${response.statusText}.`;

  return new Error(message);
};

const requestJson = async ({ apiVersion, baseUrl, body, method = 'GET', resourcePath, token }) => {
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

  return parsedBody;
};

const getCurrentFlowResourcePath = (flowId) => `powerautomate/flows/${flowId}`;

const getLegacyFlowBasePath = (envId, flowId) =>
  `providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}`;

const getLegacyFlowsCollectionPath = (envId) =>
  `providers/Microsoft.ProcessSimple/environments/${envId}/flows`;

const getPreferredLegacySession = (session) => {
  if (session.legacyApiUrl && session.legacyToken) {
    return {
      baseUrl: session.legacyApiUrl,
      source: 'captured-legacy-session',
      token: session.legacyToken,
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

const normalizeFlow = (session, flowResponse) => {
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

const normalizeFlowCatalogItem = (session, flowResponse) => {
  const properties = flowResponse?.properties || {};
  const definitionSummary = properties.definitionSummary || {};

  return {
    actionTypes: Array.isArray(definitionSummary.actions)
      ? definitionSummary.actions.map((action) => action?.type).filter(Boolean)
      : [],
    createdTime: properties.createdTime || null,
    displayName: properties.displayName || flowResponse?.name || 'Untitled flow',
    envId: session.envId,
    flowId: flowResponse?.name || null,
    lastModifiedTime: properties.lastModifiedTime || null,
    state: properties.state || null,
    triggerTypes: Array.isArray(definitionSummary.triggers)
      ? definitionSummary.triggers.map((trigger) => trigger?.type).filter(Boolean)
      : [],
    userType: properties.userType || null,
  };
};

const normalizeLegacyFlow = (session, flowResponse) => {
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

const normalizeSnapshot = (snapshot) => ({
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

const getDisplayNameFromSnapshot = (snapshot) =>
  snapshot?.displayName || snapshot?.flow?.definition?.metadata?.displayName || null;

const resolveCurrentTabFlowName = (session) => {
  if (!session?.flowId) return null;

  const snapshot = getFlowSnapshotForFlow({ envId: session.envId, flowId: session.flowId }) || getFlowSnapshot();

  if (snapshot?.flowId === session.flowId && snapshot?.envId === session.envId) {
    return getDisplayNameFromSnapshot(snapshot);
  }

  const catalog = getFlowCatalogForEnv(session.envId);
  return catalog?.flows?.find((flow) => flow.flowId === session.flowId)?.displayName || null;
};

const resolveTargetDisplayName = (session) => {
  const target = getActiveOrTabTarget(session);

  if (!target?.flowId) return null;
  if (target.displayName) return target.displayName;

  const catalog = getFlowCatalogForEnv(target.envId);
  const catalogMatch = catalog?.flows?.find((flow) => flow.flowId === target.flowId);
  if (catalogMatch?.displayName) return catalogMatch.displayName;

  const snapshot = getFlowSnapshotForFlow({ envId: target.envId, flowId: target.flowId });
  return getDisplayNameFromSnapshot(snapshot);
};

const summarizeFlowForHistory = (normalizedFlow) => {
  const actions = normalizedFlow?.flow?.definition?.actions || {};
  const triggers = normalizedFlow?.flow?.definition?.triggers || {};

  return {
    actionCount: Object.keys(actions).length,
    actionNames: Object.keys(actions),
    displayName: normalizedFlow?.displayName || '',
    triggerCount: Object.keys(triggers).length,
  };
};

const createLastUpdateRecord = ({ before, after }) => {
  const beforeSummary = summarizeFlowForHistory(before);
  const afterSummary = summarizeFlowForHistory(after);

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
        (name) =>
          !beforeSummary.actionNames.includes(name) ||
          !afterSummary.actionNames.includes(name),
      ),
      changedDefinition:
        JSON.stringify(before.flow.definition) !== JSON.stringify(after.flow.definition) ||
        JSON.stringify(before.flow.connectionReferences) !== JSON.stringify(after.flow.connectionReferences),
      changedDisplayName: before.displayName !== after.displayName,
      changedFlowBody:
        JSON.stringify(before.flow.definition) !== JSON.stringify(after.flow.definition) ||
        JSON.stringify(before.flow.connectionReferences) !== JSON.stringify(after.flow.connectionReferences),
    },
  };
};

const fetchRawFlowModern = async (session, flowId = session.flowId) =>
  requestJson({
    apiVersion: MODERN_API_VERSION,
    baseUrl: session.apiUrl,
    method: 'GET',
    resourcePath: getCurrentFlowResourcePath(flowId),
    token: session.apiToken,
  });

const fetchRawFlowLegacy = async (session, flowId = session.flowId) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  return requestJson({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: getLegacyFlowBasePath(session.envId, flowId),
    token: legacySession.token,
  });
};

const listFlowsLegacy = async (session) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  const response = await requestJson({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: getLegacyFlowsCollectionPath(session.envId),
    token: legacySession.token,
  });

  const flows = Array.isArray(response?.value)
    ? response.value
        .map((flow) => normalizeFlowCatalogItem(session, flow))
        .filter((flow) => flow.flowId)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
    : [];

  const catalog = {
    capturedAt: new Date().toISOString(),
    envId: session.envId,
    flows,
    source: legacySession.source,
  };

  await saveFlowCatalog(catalog);
  return catalog;
};

const filterCatalogFlows = (catalog, { limit = 100, query } = {}) => {
  const normalizedQuery = query?.trim().toLowerCase() || null;
  const filteredFlows = normalizedQuery
    ? catalog.flows.filter((flow) => flow.displayName.toLowerCase().includes(normalizedQuery))
    : catalog.flows;

  return {
    ...catalog,
    flows: filteredFlows.slice(0, limit),
    total: filteredFlows.length,
  };
};

export const getStatus = () => {
  const session = getSession();
  const legacySession = session ? getPreferredLegacySession(session) : null;
  const activeTarget = session ? getActiveOrTabTarget(session) : null;
  const targetDisplayName = session ? resolveTargetDisplayName(session) : null;
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
          displayName: targetDisplayName,
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

export const getCurrentFlow = async () => {
  const session = ensureTargetSession();

  try {
    const flowResponse = await fetchRawFlowModern(session);
    return normalizeFlow(session, flowResponse);
  } catch {
    try {
      const legacyFlowResponse = await fetchRawFlowLegacy(session);
      return normalizeLegacyFlow(session, legacyFlowResponse);
    } catch (legacyError) {
      const snapshot =
        getFlowSnapshotForFlow({ envId: session.envId, flowId: session.flowId }) || getFlowSnapshot();

      if (snapshot && snapshot.flowId === session.flowId && snapshot.envId === session.envId) {
        return normalizeSnapshot(snapshot);
      }

      throw legacyError;
    }
  }
};

export const refreshFlows = async () => {
  const session = ensureSession();
  return listFlowsLegacy(session);
};

export const listFlows = async ({ limit = 100, query } = {}) => {
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

export const setActiveFlow = async ({ flowId, selectionSource = 'manual' }) => {
  const session = ensureSession();
  const catalog = getFlowCatalogForEnv(session.envId) || (await listFlowsLegacy(session));
  const matchingFlow = catalog.flows.find((flow) => flow.flowId === flowId);

  if (!matchingFlow) {
    throw new PowerAutomateSessionError(
      `The flow ${flowId} was not found in the current environment catalog. Refresh flows and try again.`,
    );
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

export const setActiveFlowFromTab = async () => {
  const session = ensureSession();

  if (!session.flowId) {
    throw new PowerAutomateSessionError('No flow is associated with the current browser tab yet.');
  }

  if (!getFlowCatalogForEnv(session.envId)) {
    await listFlowsLegacy(session);
  }

  return setActiveFlow({
    flowId: session.flowId,
    selectionSource: 'tab-capture',
  });
};

export const getActiveFlow = async () => {
  const session = ensureSession();
  const target = getActiveOrTabTarget(session);

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
      displayName: matchingFlow?.displayName || resolveTargetDisplayName(session),
    },
    currentTab: {
      displayName: resolveCurrentTabFlowName(session),
      envId: session.envId,
      flowId: session.flowId || null,
    },
  };
};

const updateCurrentFlowModern = async (session, { displayName, flow }) => {
  const before = normalizeFlow(session, await fetchRawFlowModern(session));
  const currentProperties = {
    connectionReferences: before.flow.connectionReferences,
    definition: before.flow.definition,
    displayName: before.displayName,
    environment: before.environment,
  };

  const updatedFlow = await requestJson({
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
  await saveLastUpdate(createLastUpdateRecord({ after, before }));
  return after;
};

const updateCurrentFlowLegacy = async (session, { displayName, flow }) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  const before = normalizeLegacyFlow(session, await fetchRawFlowLegacy(session));
  const currentProperties = {
    connectionReferences: before.flow.connectionReferences,
    definition: before.flow.definition,
    displayName: before.displayName,
    environment: before.environment,
  };

  const updatedFlow = await requestJson({
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
  await saveLastUpdate(createLastUpdateRecord({ after, before }));
  return after;
};

export const updateCurrentFlow = async ({ displayName, flow }) => {
  const session = ensureTargetSession();

  try {
    return await updateCurrentFlowModern(session, { displayName, flow });
  } catch {
    return updateCurrentFlowLegacy(session, { displayName, flow });
  }
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

const createFlowLegacy = async (session, { displayName, flow }) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  const createdFlow = await requestJson({
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

export const createFlow = async ({ displayName, triggerType = 'request' }) => {
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

export const cloneFlow = async ({ displayName, makeActive = true, sourceFlowId }) => {
  const session = ensureSession();
  const sourceResponse = await fetchRawFlowLegacy(session, sourceFlowId);
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

export const getLastUpdateSummary = () => {
  const session = getSession();

  if (!session) {
    return getLastUpdate();
  }

  const target = getActiveOrTabTarget(session);
  return target ? getLastUpdateForFlow(target) || getLastUpdate() : getLastUpdate();
};

export const revertLastUpdate = async () => {
  const session = ensureTargetSession();
  const lastUpdate = getLastUpdateForFlow(session) || getLastUpdate();

  if (!lastUpdate) {
    throw new PowerAutomateSessionError('No previous update is available to revert.');
  }

  if (lastUpdate.flowId !== session.flowId || lastUpdate.envId !== session.envId) {
    throw new PowerAutomateSessionError(
      'The active flow does not match the last updated flow. Open the same flow before reverting.',
    );
  }

  return updateCurrentFlow({
    displayName: lastUpdate.before.displayName,
    flow: lastUpdate.before.flow,
  });
};

const normalizeIssues = (issues) => {
  if (Array.isArray(issues)) return issues;
  if (Array.isArray(issues?.value)) return issues.value;
  return [];
};

const extractNameFromId = (value) => {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('/').filter(Boolean);
  return parts.at(-1) || null;
};

const normalizeRun = (session, run) => {
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
    runId: run?.name || properties.runName || extractNameFromId(run?.id),
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

const normalizeRunAction = (action) => {
  const properties = action?.properties || {};
  const status = (properties.status || properties.state || null);
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

const listRunsLegacy = async (session, { limit = 10 } = {}) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  const response = await requestJson({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: `${getLegacyFlowBasePath(session.envId, session.flowId)}/runs`,
    token: legacySession.token,
  });

  const runs = Array.isArray(response?.value) ? response.value : [];

  return {
    runs: runs.slice(0, limit).map((run) => normalizeRun(session, run)),
    source: legacySession.source,
  };
};

const getRunLegacy = async (session, runId) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  const run = await requestJson({
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

const getRunActionsLegacy = async (session, runId) => {
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  const response = await requestJson({
    apiVersion: LEGACY_API_VERSION,
    baseUrl: legacySession.baseUrl,
    method: 'GET',
    resourcePath: `${getLegacyFlowBasePath(session.envId, session.flowId)}/runs/${runId}/actions`,
    token: legacySession.token,
  });

  const actions = Array.isArray(response?.value) ? response.value : [];

  return {
    actions: actions.map(normalizeRunAction),
    source: legacySession.source,
  };
};

const withFailedAction = (run, actions) => {
  const failedAction =
    actions.find((action) => ['failed', 'timedout', 'cancelled', 'canceled'].includes((action.status || '').toLowerCase())) ||
    actions.find(
      (action) =>
        action.errorMessage &&
        !['skipped', 'succeeded'].includes((action.status || '').toLowerCase()),
    );

  return {
    ...run,
    errorMessage: run.errorMessage || failedAction?.errorMessage || null,
    failedActionName: failedAction?.name || null,
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getCurrentTriggerName = async (session) => {
  const flow = await getCurrentFlow();
  const triggerNames = Object.keys(flow.flow.definition.triggers || {});
  const triggerName = triggerNames[0] || null;

  if (!triggerName) {
    throw new PowerAutomateSessionError('No trigger was found in the current flow definition.');
  }

  return triggerName;
};

export const validateCurrentFlow = async ({ flow }) => {
  const session = ensureTargetSession();
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

export const listRuns = async ({ limit = 10 } = {}) => {
  const session = ensureTargetSession();
  return listRunsLegacy(session, { limit });
};

export const getRun = async ({ runId }) => {
  const session = ensureTargetSession();
  const [{ actions, source }, { run }] = await Promise.all([
    getRunActionsLegacy(session, runId),
    getRunLegacy(session, runId),
  ]);

  return {
    run: withFailedAction(run, actions),
    source,
  };
};

export const getRunActions = async ({ runId }) => {
  const session = ensureTargetSession();
  return getRunActionsLegacy(session, runId);
};

export const getLatestRun = async () => {
  const session = ensureTargetSession();
  const { runs, source } = await listRunsLegacy(session, { limit: 1 });
  let run = runs[0] || null;

  if (run?.runId) {
    const detail = await getRun({ runId: run.runId });
    run = detail.run;
  }

  return {
    run,
    source,
  };
};

export const refreshLatestRun = async () => {
  const session = ensureTargetSession();
  const latest = await getLatestRun();

  const payload = {
    capturedAt: new Date().toISOString(),
    envId: session.envId,
    flowId: session.flowId,
    run: latest.run,
  };

  await saveLastRun(payload);
  return payload;
};

export const getLastRunSummary = () => {
  const session = getSession();

  if (!session) {
    return getLastRun();
  }

  const target = getActiveOrTabTarget(session);
  return target ? getLastRunForFlow(target) || getLastRun() : getLastRun();
};

export const waitForRun = async ({ pollIntervalSeconds = 5, runId, timeoutSeconds = 60 } = {}) => {
  const session = ensureTargetSession();
  const deadline = Date.now() + timeoutSeconds * 1000;
  let targetRunId = runId;

  while (Date.now() <= deadline) {
    if (!targetRunId) {
      const latest = await getLatestRun();
      targetRunId = latest.run?.runId || null;

      if (!targetRunId) {
        await sleep(pollIntervalSeconds * 1000);
        continue;
      }
    }

    const detail = await getRun({ runId: targetRunId });
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

export const getTriggerCallbackUrl = async ({ triggerName } = {}) => {
  const session = ensureTargetSession();
  const legacySession = getPreferredLegacySession(session);

  if (!legacySession) {
    throw new PowerAutomateSessionError(
      'No flow-compatible legacy token is available yet. Refresh the flow page again to capture a better token.',
    );
  }

  const effectiveTriggerName = triggerName || (await getCurrentTriggerName(session));
  const response = await requestJson({
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

export const invokeTrigger = async ({ body = {}, triggerName } = {}) => {
  const callback = await getTriggerCallbackUrl({ triggerName });

  if (!callback.url) {
    throw new PowerAutomateSessionError('The trigger callback URL is missing or invalid.');
  }

  const response = await fetch(callback.url, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    method: callback.method || 'POST',
  });

  const responseText = await response.text();
  let parsedBody = responseText;

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
