import type { PopupStatusPayload } from '../server/bridge-types.js';
import type { FlowCatalogItem, LastUpdate, RunSummary } from '../server/schemas.js';
import type { DashboardPayload } from './types.js';

export type AttentionSeverity = 'critical' | 'info' | 'success' | 'warning';

export interface DashboardAttentionItem {
  actionLabel?: string;
  actionType?: 'open-side-panel' | 'refresh-current-tab' | 'refresh-last-run' | 'set-active-flow-from-tab';
  description: string;
  id: string;
  severity: AttentionSeverity;
  title: string;
}

export interface DashboardModel {
  activeTarget: DashboardFlowReference | null;
  attentionItems: DashboardAttentionItem[];
  bridgeMode: string | null;
  bridgeOnline: boolean;
  catalogFlows: FlowCatalogItem[];
  currentTab: DashboardFlowReference | null;
  diagnostics: {
    capturedAt: string | null;
    envId: string | null;
    error: string | null;
    lastSentAt: string | null;
    snapshotSource: string | null;
    tokenSource: string | null;
  };
  flowCatalogMessage: string | null;
  hasLegacyApi: boolean;
  hasSession: boolean;
  lastRun: RunSummary | null;
  lastRunStatus: string | null;
  lastUpdate: LastUpdate | null;
  pinnedFlows: DashboardFlowReference[];
  recentFlows: DashboardFlowReference[];
  selectedTargetMismatch: boolean;
  statusLabel: string;
  statusMessage: string;
}

export interface DashboardFlowReference {
  accessScope?: FlowCatalogItem['accessScope'];
  displayName: string;
  envId: string | null;
  flowId: string;
  isPinned: boolean;
  isRecent: boolean;
  selectedAt?: string | null;
  selectionSource?: string | null;
}

const formatFallbackName = (flowId: string) => `Flow ${flowId.slice(0, 8)}`;

const toReference = ({
  fallback,
  flow,
  flags,
}: {
  fallback?: {
    displayName?: string | null;
    envId?: string | null;
    flowId?: string | null;
    selectedAt?: string | null;
    selectionSource?: string | null;
  } | null;
  flow?: FlowCatalogItem | null;
  flags?: { isPinned?: boolean; isRecent?: boolean };
}): DashboardFlowReference | null => {
  const flowId = flow?.flowId || fallback?.flowId;

  if (!flowId) return null;

  return {
    accessScope: flow?.accessScope,
    displayName: flow?.displayName || fallback?.displayName || formatFallbackName(flowId),
    envId: flow?.envId || fallback?.envId || null,
    flowId,
    isPinned: Boolean(flags?.isPinned),
    isRecent: Boolean(flags?.isRecent),
    selectedAt: fallback?.selectedAt || null,
    selectionSource: fallback?.selectionSource || null,
  };
};

const getSelectedRun = (payload: PopupStatusPayload, activeTarget: DashboardFlowReference | null) => {
  if (!payload.lastRun || !activeTarget?.flowId || !activeTarget.envId) return null;

  const sameFlow =
    payload.lastRun.flowId === activeTarget.flowId && payload.lastRun.envId === activeTarget.envId;

  return sameFlow ? payload.lastRun.run || null : null;
};

const getSelectedUpdate = (payload: PopupStatusPayload, activeTarget: DashboardFlowReference | null) => {
  if (!payload.lastUpdate || !activeTarget?.flowId || !activeTarget.envId) return null;

  const sameFlow =
    payload.lastUpdate.flowId === activeTarget.flowId && payload.lastUpdate.envId === activeTarget.envId;

  return sameFlow ? payload.lastUpdate : null;
};

const buildAttentionItems = ({
  activeTarget,
  currentTab,
  error,
  hasLegacyApi,
  hasSession,
  lastRun,
  lastUpdate,
  selectedTargetMismatch,
}: {
  activeTarget: DashboardFlowReference | null;
  currentTab: DashboardFlowReference | null;
  error: string | null;
  hasLegacyApi: boolean;
  hasSession: boolean;
  lastRun: RunSummary | null;
  lastUpdate: LastUpdate | null;
  selectedTargetMismatch: boolean;
}): DashboardAttentionItem[] => {
  const items: DashboardAttentionItem[] = [];

  if (error) {
    items.push({
      actionLabel: 'Refresh capture',
      actionType: 'refresh-current-tab',
      description: error,
      id: 'bridge-error',
      severity: 'critical',
      title: 'The extension has an actionable error right now.',
    });
  }

  if (!hasSession) {
    items.push({
      actionLabel: 'Refresh capture',
      actionType: 'refresh-current-tab',
      description: 'Open a flow page and refresh the tab so the browser session, token, and flow snapshot can be captured.',
      id: 'missing-session',
      severity: 'warning',
      title: 'No active Power Automate session is captured.',
    });
  }

  if (selectedTargetMismatch && activeTarget && currentTab) {
    items.push({
      actionLabel: 'Use current tab',
      actionType: 'set-active-flow-from-tab',
      description: `${activeTarget.displayName} is selected, but the browser is showing ${currentTab.displayName}.`,
      id: 'target-mismatch',
      severity: 'warning',
      title: 'The MCP target is different from the current tab.',
    });
  }

  if (hasSession && !hasLegacyApi) {
    items.push({
      actionLabel: 'Refresh capture',
      actionType: 'refresh-current-tab',
      description: 'The session is live, but legacy-compatible operations like validation may need a fresh token capture.',
      id: 'legacy-missing',
      severity: 'warning',
      title: 'Validation and some flow operations are not fully ready yet.',
    });
  }

  if ((lastRun?.status || '').toLowerCase() === 'failed' && lastRun) {
    items.push({
      actionLabel: 'Refresh run',
      actionType: 'refresh-last-run',
      description: lastRun.failedActionName
        ? `The latest run failed at ${lastRun.failedActionName}.`
        : 'The latest run failed and needs investigation.',
      id: 'last-run-failed',
      severity: 'critical',
      title: 'The latest run for the selected flow failed.',
    });
  }

  if (lastUpdate?.summary?.changedFlowBody) {
    items.push({
      actionLabel: 'Open side panel',
      actionType: 'open-side-panel',
      description: 'A logic-changing update exists for this flow. Review it before making another edit.',
      id: 'logic-updated',
      severity: 'info',
      title: 'The selected flow has a cached logic change.',
    });
  }

  if (items.length === 0) {
    items.push({
      description: 'Target, session, and browser tab are aligned. The extension is ready for day-to-day inspection and safe actions.',
      id: 'all-good',
      severity: 'success',
      title: 'Everything looks healthy for the selected flow.',
    });
  }

  return items;
};

export const deriveDashboardModel = (payload: DashboardPayload): DashboardModel => {
  const status = payload.status;
  const flowCatalog = payload.flowCatalog;
  const catalogFlows = flowCatalog?.flows || [];
  const activeFlow = (status.activeFlow || null) as
    | {
        activeTarget?: {
          displayName?: string | null;
          envId?: string | null;
          flowId?: string | null;
          selectedAt?: string | null;
          selectionSource?: string | null;
        } | null;
        currentTab?: {
          displayName?: string | null;
          envId?: string | null;
          flowId?: string | null;
        } | null;
      }
    | null;

  const activeTargetItem =
    catalogFlows.find((flow) => flow.flowId === activeFlow?.activeTarget?.flowId) || null;
  const currentTabItem =
    catalogFlows.find((flow) => flow.flowId === activeFlow?.currentTab?.flowId) || null;

  const pinnedIdSet = new Set(payload.pinnedFlowIds);
  const recentIdSet = new Set(payload.recentFlowIds);

  const activeTarget = toReference({
    fallback: activeFlow?.activeTarget,
    flags: {
      isPinned: pinnedIdSet.has(activeFlow?.activeTarget?.flowId || ''),
      isRecent: recentIdSet.has(activeFlow?.activeTarget?.flowId || ''),
    },
    flow: activeTargetItem,
  });

  const currentTab = toReference({
    fallback: activeFlow?.currentTab,
    flags: {
      isPinned: pinnedIdSet.has(activeFlow?.currentTab?.flowId || ''),
      isRecent: recentIdSet.has(activeFlow?.currentTab?.flowId || ''),
    },
    flow: currentTabItem,
  });

  const lastRun = getSelectedRun(status, activeTarget);
  const lastUpdate = getSelectedUpdate(status, activeTarget);
  const selectedTargetMismatch =
    Boolean(activeTarget?.flowId && currentTab?.flowId && activeTarget.flowId !== currentTab.flowId);
  const bridgeOnline = Boolean(status.bridge?.ok);
  const hasSession =
    Boolean(status.session) ||
    Boolean((status.bridge as { hasSession?: boolean } | null)?.hasSession) ||
    Boolean(activeTarget?.flowId);
  const hasLegacyApi =
    Boolean(status.session?.legacyApiUrl && status.session?.legacyToken) ||
    Boolean((status.bridge as { hasLegacyApi?: boolean } | null)?.hasLegacyApi);
  const error = status.error || status.lastError || null;

  const statusLabel = !bridgeOnline
    ? 'Bridge offline'
    : !hasSession
      ? 'Awaiting session'
      : selectedTargetMismatch
        ? 'Target mismatch'
        : (lastRun?.status || '').toLowerCase() === 'failed'
          ? 'Run failed'
          : !hasLegacyApi
            ? 'Session needs refresh'
            : 'Ready';

  const statusMessage = !bridgeOnline
    ? 'The popup cannot reach the local bridge.'
    : !hasSession
      ? 'Open a flow page and refresh the browser tab to capture context.'
      : selectedTargetMismatch
        ? 'You are looking at one flow while the MCP target points to another.'
        : (lastRun?.status || '').toLowerCase() === 'failed'
          ? 'The latest run failed, so this flow likely needs attention before more edits.'
          : !hasLegacyApi
            ? 'The flow is visible, but validation-grade operations need a fresh legacy-compatible token.'
            : 'The extension is ready for inspection, targeting, validation, and safe follow-up actions.';

  const mapIdsToFlows = (ids: string[]) =>
    ids
      .map((flowId) =>
        toReference({
          flags: {
            isPinned: pinnedIdSet.has(flowId),
            isRecent: recentIdSet.has(flowId),
          },
          flow: catalogFlows.find((item) => item.flowId === flowId) || null,
        }),
      )
      .filter((flow): flow is DashboardFlowReference => Boolean(flow));

  return {
    activeTarget,
    attentionItems: buildAttentionItems({
      activeTarget,
      currentTab,
      error,
      hasLegacyApi,
      hasSession,
      lastRun,
      lastUpdate,
      selectedTargetMismatch,
    }),
    bridgeMode: status.bridge?.bridgeMode || null,
    bridgeOnline,
    catalogFlows,
    currentTab,
    diagnostics: {
      capturedAt: status.session?.capturedAt || status.bridge?.capturedAt || null,
      envId: status.session?.envId || activeTarget?.envId || currentTab?.envId || null,
      error,
      lastSentAt: status.lastSentAt || null,
      snapshotSource: status.snapshot?.source || null,
      tokenSource: status.tokenMeta?.source || null,
    },
    flowCatalogMessage: flowCatalog?.message || null,
    hasLegacyApi,
    hasSession,
    lastRun,
    lastRunStatus: lastRun?.status || null,
    lastUpdate,
    pinnedFlows: mapIdsToFlows(payload.pinnedFlowIds),
    recentFlows: mapIdsToFlows(payload.recentFlowIds),
    selectedTargetMismatch,
    statusLabel,
    statusMessage,
  };
};
