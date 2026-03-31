import { getFlowSnapshot } from './flow-snapshot-store.mjs';
import { getLastRun, saveLastRun } from './last-run-store.mjs';
import { editorSchema } from './schemas.mjs';
import { getSession } from './session-store.mjs';
import { getTokenAudit } from './token-audit-store.mjs';
import { getLastUpdate, saveLastUpdate } from './update-history-store.mjs';

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

const fetchRawCurrentFlowModern = async (session) =>
  requestJson({
    apiVersion: MODERN_API_VERSION,
    baseUrl: session.apiUrl,
    method: 'GET',
    resourcePath: getCurrentFlowResourcePath(session.flowId),
    token: session.apiToken,
  });

const fetchRawCurrentFlowLegacy = async (session) => {
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
    resourcePath: getLegacyFlowBasePath(session.envId, session.flowId),
    token: legacySession.token,
  });
};

export const getStatus = () => {
  const session = getSession();
  const legacySession = session ? getPreferredLegacySession(session) : null;

  if (!session) {
    return {
      connected: false,
      message: 'Open or refresh a flow in Power Automate with the extension enabled to capture a session.',
    };
  }

  return {
    capturedAt: session.capturedAt,
    connected: true,
    envId: session.envId,
    flowId: session.flowId,
    hasLegacyApi: Boolean(legacySession),
    legacySource: legacySession?.source || null,
    portalUrl: session.portalUrl || null,
  };
};

export const getCurrentFlow = async () => {
  const session = ensureSession();

  try {
    const flowResponse = await fetchRawCurrentFlowModern(session);
    return normalizeFlow(session, flowResponse);
  } catch {
    try {
      const legacyFlowResponse = await fetchRawCurrentFlowLegacy(session);
      return normalizeLegacyFlow(session, legacyFlowResponse);
    } catch (legacyError) {
      const snapshot = getFlowSnapshot();

      if (snapshot && snapshot.flowId === session.flowId && snapshot.envId === session.envId) {
        return normalizeSnapshot(snapshot);
      }

      throw legacyError;
    }
  }
};

const updateCurrentFlowModern = async (session, { displayName, flow }) => {
  const before = normalizeFlow(session, await fetchRawCurrentFlowModern(session));
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

  const before = normalizeLegacyFlow(session, await fetchRawCurrentFlowLegacy(session));
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
  const session = ensureSession();

  try {
    return await updateCurrentFlowModern(session, { displayName, flow });
  } catch {
    return updateCurrentFlowLegacy(session, { displayName, flow });
  }
};

export const getLastUpdateSummary = () => getLastUpdate();

export const revertLastUpdate = async () => {
  const session = ensureSession();
  const lastUpdate = getLastUpdate();

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
  const session = ensureSession();
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
  const session = ensureSession();
  return listRunsLegacy(session, { limit });
};

export const getRun = async ({ runId }) => {
  const session = ensureSession();
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
  const session = ensureSession();
  return getRunActionsLegacy(session, runId);
};

export const getLatestRun = async () => {
  const session = ensureSession();
  const { runs, source } = await listRunsLegacy(session, { limit: 1 });
  const run = runs[0] || null;

  return {
    run,
    source,
  };
};

export const refreshLatestRun = async () => {
  const session = ensureSession();
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

export const getLastRunSummary = () => getLastRun();

export const waitForRun = async ({ pollIntervalSeconds = 5, runId, timeoutSeconds = 60 } = {}) => {
  const session = ensureSession();
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
  const session = ensureSession();
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
