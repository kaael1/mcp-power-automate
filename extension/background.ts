import type { ContextPayload, PopupStatusPayload, PopupTokenMeta } from '../server/bridge-types.js';
import type { FlowSnapshot, LastRun, LastUpdate, Session, TokenAudit } from '../server/schemas.js';
import { decodeJwtPayload, scoreToken } from './token-utils.js';
import { buildBaseUrl, extractAuthorization, extractFromApiUrl, extractFromPortalUrl } from './url-utils.js';
import {
  BRIDGE_URL,
  type BackgroundState,
  type BackgroundTabState,
  type DashboardPayload,
  type FlowCatalogPayload,
  type PersistSessionStatusInput,
  type RuntimeMessage,
  STORAGE_KEYS,
  type StorageShape,
} from './types.js';

const state: BackgroundState = {
  lastSentSignature: null,
  tabs: {},
};

const LEGACY_FLOW_BASE_URL = 'https://api.flow.microsoft.com/';

const isLegacyCompatibleAudience = (audience: string | undefined) =>
  audience === 'https://service.flow.microsoft.com/' ||
  audience === 'https://service.powerapps.com/';

const getTabState = (tabId: number) => {
  if (!state.tabs[tabId]) {
    state.tabs[tabId] = {};
  }

  return state.tabs[tabId] as BackgroundTabState;
};

const syncCapturedTabContext = async (
  tabId: number,
  context: {
    envId?: string | null;
    flowId?: string | null;
    portalUrl?: string | null;
  },
) => {
  const tabState = getTabState(tabId);

  if (context.envId) tabState.envId = context.envId;
  if (context.flowId) tabState.flowId = context.flowId;
  if (context.portalUrl) tabState.portalUrl = context.portalUrl;

  if (tabState.apiUrl && tabState.apiToken && tabState.envId && tabState.flowId) {
    const session = buildSessionFromTabState(tabState);
    if (session) {
      await maybeSendSession(session);
    }
  }
};

const getStorage = <T extends StorageShape = StorageShape>(keys: string[]) =>
  new Promise<T>((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result as T));
  });

const setStorage = (payload: StorageShape) =>
  new Promise<void>((resolve) => {
    chrome.storage.local.set(payload, () => resolve());
  });

const removeStorage = (keys: string[]) =>
  new Promise<void>((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });

const getTab = (tabId: number) =>
  new Promise<chrome.tabs.Tab | null>((resolve) => {
    chrome.tabs.get(tabId, (tab) => resolve(tab || null));
  });

const queryTabs = (queryInfo: chrome.tabs.QueryInfo) =>
  new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query(queryInfo, resolve);
  });

const readJsonResponse = async <T>(response: Response) => {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
};

const getStoredFlowIds = async (key: typeof STORAGE_KEYS.pinnedFlowIds | typeof STORAGE_KEYS.recentFlowIds) => {
  const storage = await getStorage([key]);
  const value = storage[key];

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const saveStoredFlowIds = async (
  key: typeof STORAGE_KEYS.pinnedFlowIds | typeof STORAGE_KEYS.recentFlowIds,
  value: string[],
) => {
  const normalized = [...new Set(value.filter(Boolean))];
  await setStorage({
    [key]: normalized,
  });

  return normalized;
};

const touchRecentFlowId = async (flowId: string | null | undefined) => {
  if (!flowId) return [];

  const current = await getStoredFlowIds(STORAGE_KEYS.recentFlowIds);
  const next = [flowId, ...current.filter((item) => item !== flowId)].slice(0, 12);
  return saveStoredFlowIds(STORAGE_KEYS.recentFlowIds, next);
};

const maybePromoteApiToken = async (tabState: BackgroundTabState, nextToken: string, source: string) => {
  if (!nextToken) return;

  const current = scoreToken(tabState.apiToken || '');
  const candidate = scoreToken(nextToken);

  if (!tabState.apiToken || candidate.score >= current.score) {
    const nextMeta: PopupTokenMeta = {
      score: candidate.score,
      scope: candidate.scopeText,
      source,
    };

    tabState.apiToken = nextToken;
    tabState.apiTokenMeta = nextMeta;
    await setStorage({
      [STORAGE_KEYS.tokenMeta]: nextMeta,
    });
  }
};

const buildSessionSignature = (session: Session) =>
  JSON.stringify({
    apiToken: session.apiToken,
    apiUrl: session.apiUrl,
    envId: session.envId,
    flowId: session.flowId,
    legacyApiUrl: session.legacyApiUrl || null,
    legacyToken: session.legacyToken || null,
  });

const checkBridgeHealth = async () => {
  try {
    const response = await fetch(`${BRIDGE_URL}/health`);
    const body = (await response.json()) as Record<string, unknown>;
    await setStorage({ [STORAGE_KEYS.lastHealth]: body });
    return body;
  } catch (error) {
    const fallback = {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
    await setStorage({ [STORAGE_KEYS.lastHealth]: fallback });
    return fallback;
  }
};

const postSessionToBridge = async (session: Session) => {
  const response = await fetch(`${BRIDGE_URL}/session`, {
    body: JSON.stringify(session),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Bridge request failed with ${response.status}`);
  }

  return body;
};

const postSnapshotToBridge = async (snapshot: FlowSnapshot) => {
  const response = await fetch(`${BRIDGE_URL}/snapshot`, {
    body: JSON.stringify(snapshot),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Snapshot bridge request failed with ${response.status}`);
  }

  return body;
};

const postTokenAuditToBridge = async (audit: TokenAudit) => {
  const response = await fetch(`${BRIDGE_URL}/token-audit`, {
    body: JSON.stringify(audit),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Token audit bridge request failed with ${response.status}`);
  }

  return body;
};

const getLastUpdateFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/last-update`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Last update bridge request failed with ${response.status}`);
  }

  return (body.lastUpdate || null) as LastUpdate | null;
};

const getContextFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/context`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Context bridge request failed with ${response.status}`);
  }

  return body as ContextPayload;
};

const getLastRunFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/last-run`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Last run bridge request failed with ${response.status}`);
  }

  return (body.lastRun || null) as LastRun | null;
};

const getActiveFlowFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/active-flow`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Active flow bridge request failed with ${response.status}`);
  }

  return body.activeFlow || null;
};

const getFlowCatalogFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/flows`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Flow catalog bridge request failed with ${response.status}`);
  }

  const flows = (body.flows || null) as FlowCatalogPayload | null;

  if (flows) {
    await setStorage({
      [STORAGE_KEYS.flowCatalog]: flows,
    });
  }

  return flows;
};

const postRefreshFlowsToBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/refresh-flows`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Refresh flows bridge request failed with ${response.status}`);
  }

  const flows = (body.flows || null) as FlowCatalogPayload | null;

  if (flows) {
    await setStorage({
      [STORAGE_KEYS.flowCatalog]: flows,
    });
  }

  return flows;
};

const postSetActiveFlowToBridge = async (flowId: string) => {
  const response = await fetch(`${BRIDGE_URL}/active-flow`, {
    body: JSON.stringify({ flowId }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Set active flow bridge request failed with ${response.status}`);
  }

  return body.activeFlow || null;
};

const postSetActiveFlowFromTabToBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/active-flow/from-tab`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Set active flow bridge request failed with ${response.status}`);
  }

  return body.activeFlow || null;
};

const postRevertLastUpdateToBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/revert-last-update`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Revert bridge request failed with ${response.status}`);
  }

  return body;
};

const postRefreshLastRunToBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/refresh-last-run`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await readJsonResponse<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error((body.error as string | undefined) || `Refresh run bridge request failed with ${response.status}`);
  }

  return (body.lastRun || null) as LastRun | null;
};

const persistSessionStatus = async ({ error, health, sentAt, session }: PersistSessionStatusInput) => {
  const payload: StorageShape = {};

  if (error !== undefined && error !== null) payload[STORAGE_KEYS.lastError] = error;
  if (health !== undefined && health !== null) payload[STORAGE_KEYS.lastHealth] = health;
  if (sentAt !== undefined && sentAt !== null) payload[STORAGE_KEYS.lastSentAt] = sentAt;
  if (session !== undefined && session !== null) payload[STORAGE_KEYS.lastSession] = session;

  if (Object.keys(payload).length > 0) {
    await setStorage(payload);
  }

  if (error === null) {
    await removeStorage([STORAGE_KEYS.lastError]);
  }
};

const maybeSendSession = async (session: Session) => {
  const signature = buildSessionSignature(session);

  if (signature === state.lastSentSignature) {
    return false;
  }

  try {
    const bridgeResult = await postSessionToBridge(session);
    state.lastSentSignature = signature;
    await persistSessionStatus({
      error: null,
      health: { ok: true, ...bridgeResult },
      sentAt: new Date().toISOString(),
      session,
    });
    return true;
  } catch (error) {
    await persistSessionStatus({
      error: error instanceof Error ? error.message : String(error),
      health: { ok: false },
      session,
    });
    return false;
  }
};

const getPopupStatus = async (): Promise<PopupStatusPayload> => {
  const storage = await getStorage(Object.values(STORAGE_KEYS));
  const health = await checkBridgeHealth();
  let activeFlow = storage[STORAGE_KEYS.activeFlow] || null;
  let context = (storage[STORAGE_KEYS.lastContext] as ContextPayload | null) || null;
  let lastError = (storage[STORAGE_KEYS.lastError] as string | null) || null;
  let lastRun = (storage[STORAGE_KEYS.lastRun] as LastRun | null) || null;
  let lastUpdate = (storage[STORAGE_KEYS.lastUpdate] as LastUpdate | null) || null;

  if (health?.ok && lastError) {
    await removeStorage([STORAGE_KEYS.lastError]);
    lastError = null;
  }

  try {
    context = await getContextFromBridge();
    await setStorage({
      [STORAGE_KEYS.lastContext]: context,
    });
    activeFlow = {
      activeTarget: context.context.selection.activeTarget,
      currentTab: context.context.selection.currentTab,
    };
    lastRun = context.lastRun;
    lastUpdate = context.lastUpdate;
    await setStorage({
      [STORAGE_KEYS.activeFlow]: activeFlow,
      [STORAGE_KEYS.lastRun]: lastRun,
      [STORAGE_KEYS.lastUpdate]: lastUpdate,
    });
  } catch {
    try {
      lastRun = await getLastRunFromBridge();
      await setStorage({
        [STORAGE_KEYS.lastRun]: lastRun,
      });
    } catch {
      // Keep cached run info if the bridge cannot answer.
    }

    try {
      lastUpdate = await getLastUpdateFromBridge();
      await setStorage({
        [STORAGE_KEYS.lastUpdate]: lastUpdate,
      });
    } catch {
      // Keep cached update info if the bridge cannot answer.
    }

    try {
      activeFlow = await getActiveFlowFromBridge();
      await setStorage({
        [STORAGE_KEYS.activeFlow]: activeFlow,
      });
    } catch {
      // Keep cached active flow info if the bridge cannot answer.
    }
  }

  return {
    activeFlow,
    bridge:
      context ?
        {
          ...(health as PopupStatusPayload['bridge']),
          capturedAt: context.context.session.capturedAt,
          envId: context.context.session.envId || context.context.selection.resolvedTarget?.envId || null,
          hasLegacyApi: context.context.capabilities.canUseLegacyApi.available,
          hasSession: context.context.session.connected,
        }
      : (health as PopupStatusPayload['bridge']),
    context,
    lastError,
    lastRun,
    lastSentAt: (storage[STORAGE_KEYS.lastSentAt] as string | null) || null,
    lastUpdate,
    session: (storage[STORAGE_KEYS.lastSession] as Session | null) || null,
    snapshot: (storage[STORAGE_KEYS.lastSnapshot] as FlowSnapshot | null) || null,
    tokenAudit: (storage[STORAGE_KEYS.tokenAudit] as TokenAudit | null) || null,
    tokenMeta: (storage[STORAGE_KEYS.tokenMeta] as PopupTokenMeta | null) || null,
  };
};

const syncRecentFlowIds = async (activeFlow: unknown) => {
  const typedActiveFlow = activeFlow as
    | {
        activeTarget?: { flowId?: string | null } | null;
        currentTab?: { flowId?: string | null } | null;
      }
    | null;

  await touchRecentFlowId(typedActiveFlow?.activeTarget?.flowId || null);
  await touchRecentFlowId(typedActiveFlow?.currentTab?.flowId || null);
};

const getDashboard = async (): Promise<DashboardPayload> => {
  const status = await getPopupStatus();
  let flowCatalog = (await getStorage([STORAGE_KEYS.flowCatalog]))[STORAGE_KEYS.flowCatalog] as FlowCatalogPayload | undefined;

  if (!flowCatalog) {
    try {
      flowCatalog = (await getFlowCatalogFromBridge()) || flowCatalog;
    } catch {
      // Keep cached flow catalog if the bridge cannot answer.
    }
  }

  await syncRecentFlowIds(status.activeFlow);

  return {
    flowCatalog: flowCatalog || null,
    pinnedFlowIds: await getStoredFlowIds(STORAGE_KEYS.pinnedFlowIds),
    recentFlowIds: await getStoredFlowIds(STORAGE_KEYS.recentFlowIds),
    status,
  };
};

const resendLastSession = async () => {
  const storage = await getStorage([STORAGE_KEYS.lastSession]);
  const session = storage[STORAGE_KEYS.lastSession] as Session | undefined;

  if (!session) {
    throw new Error('No captured session is stored yet.');
  }

  state.lastSentSignature = null;
  await maybeSendSession(session);
  return getPopupStatus();
};

const refreshCurrentTab = async () => {
  const [tab] = await queryTabs({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active browser tab was found.');
  }

  if (!/make\.powerautomate\.com|make\.powerapps\.com|flow\.microsoft\.com/i.test(tab.url || '')) {
    throw new Error('The active tab is not a Power Automate page.');
  }

  await chrome.tabs.reload(tab.id);
  return { ok: true };
};

const openSidePanel = async (windowId?: number) => {
  if (!chrome.sidePanel?.open) {
    throw new Error('This browser does not support the extension side panel API.');
  }

  const resolvedWindowId =
    windowId ??
    (await queryTabs({ active: true, currentWindow: true }))[0]?.windowId ??
    chrome.windows.WINDOW_ID_CURRENT;

  await chrome.sidePanel.setOptions({
    enabled: true,
    path: 'sidepanel.html',
  });
  await chrome.sidePanel.open({ windowId: resolvedWindowId });

  return { ok: true };
};

const hydrateTabFromPortalUrl = async (tabId: number, tabState: BackgroundTabState) => {
  const tab = await getTab(tabId);
  const portalUrl = tab?.url || '';
  const portalData = extractFromPortalUrl(portalUrl);

  tabState.portalUrl = portalUrl || tabState.portalUrl;

  if (portalData?.envId) tabState.envId = portalData.envId;
  if (portalData?.flowId) tabState.flowId = portalData.flowId;
};

const buildSessionFromTabState = (tabState: BackgroundTabState): Session | null => {
  if (!tabState.apiUrl || !tabState.apiToken || !tabState.envId || !tabState.flowId) {
    return null;
  }

  return {
    apiToken: tabState.apiToken,
    apiUrl: tabState.apiUrl,
    capturedAt: new Date().toISOString(),
    envId: tabState.envId,
    flowId: tabState.flowId,
    legacyApiUrl: tabState.legacyApiUrl,
    legacyToken: tabState.legacyToken,
    portalUrl: tabState.portalUrl,
  };
};

type ApiRequestDetails = {
  requestHeaders?: Array<{ name: string; value?: string }>;
  tabId: number;
  url: string;
};

const handleApiRequest = async (
  details: ApiRequestDetails,
) => {
  if (details.tabId < 0) return;

  const tabState = getTabState(details.tabId);
  const matched = extractFromApiUrl(details.url);
  const token = extractAuthorization(details.requestHeaders);

  if (matched?.flowId) tabState.flowId = matched.flowId;
  if (matched?.envId) tabState.envId = matched.envId;

  if (token) {
    if (details.url.includes('.api.powerplatform.com/')) {
      tabState.apiUrl = buildBaseUrl(details.url);
      await maybePromoteApiToken(tabState, token, 'request-header');
    }

    if (details.url.includes('.api.flow.microsoft.com/')) {
      tabState.legacyToken = token;
      tabState.legacyApiUrl = buildBaseUrl(details.url);

      if (!tabState.apiUrl) {
        tabState.apiUrl = tabState.legacyApiUrl;
        tabState.apiToken = token;
      }
    }
  }

  await hydrateTabFromPortalUrl(details.tabId, tabState);

  const session = buildSessionFromTabState(tabState);

  if (session) {
    await maybeSendSession(session);
  }
};

chrome.tabs.onRemoved.addListener((tabId) => {
  delete state.tabs[tabId];
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    handleApiRequest(details).catch(async (error) => {
      await persistSessionStatus({
        error: error instanceof Error ? error.message : String(error),
      });
    });
  },
  {
    urls: ['https://*.api.flow.microsoft.com/*', 'https://*.api.powerplatform.com/*'],
  },
  ['requestHeaders', 'extraHeaders'],
);

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message?.type === 'flow-snapshot') {
    postSnapshotToBridge(message.payload)
      .then(async (result) => {
        const targetTabId = sender?.tab?.id;
        if (typeof targetTabId === 'number') {
          await syncCapturedTabContext(targetTabId, {
            envId: message.payload.envId,
            flowId: message.payload.flowId,
            portalUrl: sender?.tab?.url || null,
          });
        }
        await setStorage({
          [STORAGE_KEYS.lastSnapshot]: message.payload,
        });
        sendResponse(result);
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'token-audit') {
    postTokenAuditToBridge(message.payload)
      .then(async () => {
        const targetTabId = sender?.tab?.id;
        if (typeof targetTabId === 'number') {
          await syncCapturedTabContext(targetTabId, {
            envId: message.payload.envId,
            flowId: message.payload.flowId,
            portalUrl: message.payload.portalUrl || sender?.tab?.url || null,
          });
        }
        await setStorage({
          [STORAGE_KEYS.tokenAudit]: message.payload,
        });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'token-from-storage' || message?.type === 'token-from-msal') {
    const targetTabId = sender?.tab?.id;

    if (typeof targetTabId === 'number') {
      const tabState = getTabState(targetTabId);
      const payload = decodeJwtPayload(message.token.replace(/^Bearer\s+/i, ''));
      const portalData = extractFromPortalUrl(sender?.tab?.url || '');
      if (portalData?.envId) tabState.envId = portalData.envId;
      if (portalData?.flowId) tabState.flowId = portalData.flowId;
      if (sender?.tab?.url) tabState.portalUrl = sender.tab.url;

      if (isLegacyCompatibleAudience(payload?.aud)) {
        tabState.legacyApiUrl = LEGACY_FLOW_BASE_URL;
        tabState.legacyToken = message.token;
      }

      void maybePromoteApiToken(tabState, message.token, message.source || 'msal-silent').then(() => {
        if (tabState.apiUrl && tabState.envId && tabState.flowId) {
          const session = buildSessionFromTabState(tabState);
          if (session) {
            return maybeSendSession(session);
          }
        }

        return undefined;
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'get-status') {
    getPopupStatus()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'get-dashboard') {
    getDashboard()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'refresh-current-tab') {
    refreshCurrentTab()
      .then(async () => sendResponse(await getDashboard()))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'set-active-flow-from-tab') {
    postSetActiveFlowFromTabToBridge()
      .then(async (activeFlow) => {
        await syncRecentFlowIds(activeFlow);
        sendResponse(await getDashboard());
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'set-active-flow') {
    postSetActiveFlowToBridge(message.flowId)
      .then(async (activeFlow) => {
        await syncRecentFlowIds(activeFlow);
        sendResponse(await getDashboard());
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'refresh-flows') {
    postRefreshFlowsToBridge()
      .then(async () => sendResponse(await getDashboard()))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'toggle-pinned-flow') {
    getStoredFlowIds(STORAGE_KEYS.pinnedFlowIds)
      .then(async (pinnedIds) => {
        const next = pinnedIds.includes(message.flowId)
          ? pinnedIds.filter((flowId) => flowId !== message.flowId)
          : [message.flowId, ...pinnedIds].slice(0, 12);
        await saveStoredFlowIds(STORAGE_KEYS.pinnedFlowIds, next);
        sendResponse(await getDashboard());
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'open-side-panel') {
    openSidePanel(sender?.tab?.windowId)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'revert-last-update') {
    postRevertLastUpdateToBridge()
      .then(async () => {
        await refreshCurrentTab();
        sendResponse(await getDashboard());
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'refresh-last-run') {
    postRefreshLastRunToBridge()
      .then(async (lastRun) => {
        await setStorage({
          [STORAGE_KEYS.lastRun]: lastRun,
        });
        sendResponse(await getDashboard());
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'resend-session') {
    resendLastSession()
      .then(async () => sendResponse(await getDashboard()))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return undefined;
});
