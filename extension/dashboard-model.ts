import { createFlowReview } from '../server/client-helpers.js';
import type { PopupStatusPayload } from '../server/bridge-types.js';
import type { CaptureDiagnostic, FlowCatalogItem, LastUpdate, RunSummary } from '../server/schemas.js';
import { t, type Locale } from './i18n.js';
import type { DashboardPayload } from './types.js';

export type AttentionSeverity = 'critical' | 'info' | 'success' | 'warning';

export interface DashboardAttentionItem {
  actionLabel?: string;
  actionType?: 'open-side-panel';
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
    latestCaptureDiagnostic: CaptureDiagnostic | null;
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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getObjectKeys = (value: unknown) => (isPlainObject(value) ? Object.keys(value) : []);

const buildFallbackUpdateSummary = (lastUpdate: Pick<LastUpdate, 'after' | 'before'>): LastUpdate['summary'] => {
  const beforeActions = getObjectKeys(lastUpdate.before.flow.definition?.actions);
  const afterActions = getObjectKeys(lastUpdate.after.flow.definition?.actions);
  const beforeTriggers = getObjectKeys(lastUpdate.before.flow.definition?.triggers);
  const afterTriggers = getObjectKeys(lastUpdate.after.flow.definition?.triggers);
  const changedDefinition =
    JSON.stringify(lastUpdate.before.flow.definition) !== JSON.stringify(lastUpdate.after.flow.definition) ||
    JSON.stringify(lastUpdate.before.flow.connectionReferences) !== JSON.stringify(lastUpdate.after.flow.connectionReferences);

  return {
    afterActionCount: afterActions.length,
    afterDisplayName: lastUpdate.after.displayName ?? '',
    afterTriggerCount: afterTriggers.length,
    beforeActionCount: beforeActions.length,
    beforeDisplayName: lastUpdate.before.displayName ?? '',
    beforeTriggerCount: beforeTriggers.length,
    changedActionNames: [...new Set([...beforeActions, ...afterActions])].filter(
      (name) => !beforeActions.includes(name) || !afterActions.includes(name),
    ),
    changedDefinition,
    changedDisplayName: lastUpdate.before.displayName !== lastUpdate.after.displayName,
    changedFlowBody: changedDefinition,
  };
};

const normalizeLastUpdate = (lastUpdate: LastUpdate | null) => {
  if (!lastUpdate) return null;

  const fallbackReview = createFlowReview({
    after: lastUpdate.after,
    before: lastUpdate.before,
  });
  const fallbackSummary = buildFallbackUpdateSummary(lastUpdate);
  const storedReview = isPlainObject(lastUpdate.review) ? lastUpdate.review : null;
  const storedReviewSummary = isPlainObject(storedReview?.summary) ? storedReview.summary : null;
  const storedSections = Array.isArray(storedReview?.sections) ? storedReview.sections : null;
  const storedChangedPaths = Array.isArray(storedReview?.changedPaths) ? storedReview.changedPaths : null;
  const storedSummary = isPlainObject(lastUpdate.summary) ? lastUpdate.summary : null;

  return {
    ...lastUpdate,
    review: {
      ...fallbackReview,
      ...storedReview,
      changedPaths: storedChangedPaths || fallbackReview.changedPaths,
      sections: storedSections || fallbackReview.sections,
      summary: {
        ...fallbackReview.summary,
        ...storedReviewSummary,
        changedSectionIds:
          Array.isArray(storedReviewSummary?.changedSectionIds) ?
            storedReviewSummary.changedSectionIds
          : fallbackReview.summary.changedSectionIds,
        unchangedSectionIds:
          Array.isArray(storedReviewSummary?.unchangedSectionIds) ?
            storedReviewSummary.unchangedSectionIds
          : fallbackReview.summary.unchangedSectionIds,
      },
    },
    summary: {
      ...fallbackSummary,
      ...storedSummary,
      changedActionNames:
        Array.isArray(storedSummary?.changedActionNames) ?
          storedSummary.changedActionNames
        : fallbackSummary.changedActionNames,
    },
  } satisfies LastUpdate;
};

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

const getSelectedRun = (payload: PopupStatusPayload, flowRef: DashboardFlowReference | null) => {
  if (!payload.lastRun || !flowRef?.flowId || !flowRef.envId) return null;

  const sameFlow =
    payload.lastRun.flowId === flowRef.flowId && payload.lastRun.envId === flowRef.envId;

  return sameFlow ? payload.lastRun.run || null : null;
};

const getSelectedUpdate = (payload: PopupStatusPayload, flowRef: DashboardFlowReference | null) => {
  if (!payload.lastUpdate || !flowRef?.flowId || !flowRef.envId) return null;

  const sameFlow =
    payload.lastUpdate.flowId === flowRef.flowId && payload.lastUpdate.envId === flowRef.envId;

  return sameFlow ? normalizeLastUpdate(payload.lastUpdate) : null;
};

const hasLegacyTokenAuditCandidate = (payload: PopupStatusPayload) =>
  Boolean(
    payload.tokenAudit?.candidates?.some(
      (candidate) =>
        candidate.aud.replace(/\/+$/, '').toLowerCase() === 'https://service.flow.microsoft.com' ||
        candidate.aud.replace(/\/+$/, '').toLowerCase() === 'https://service.powerapps.com',
    ),
  );

const getDiagnosticDetailString = (diagnostic: CaptureDiagnostic | null, key: string) => {
  const value = diagnostic?.details?.[key];
  return typeof value === 'string' ? value : null;
};

const buildAttentionItems = ({
  activeTarget,
  currentTab,
  error,
  hasLegacyApi,
  hasSession,
  lastRun,
  lastUpdate,
  locale,
  selectedTargetMismatch,
}: {
  activeTarget: DashboardFlowReference | null;
  currentTab: DashboardFlowReference | null;
  error: string | null;
  hasLegacyApi: boolean;
  hasSession: boolean;
  lastRun: RunSummary | null;
  lastUpdate: LastUpdate | null;
  locale: Locale;
  selectedTargetMismatch: boolean;
}): DashboardAttentionItem[] => {
  const items: DashboardAttentionItem[] = [];

  if (error) {
    items.push({
      description: error,
      id: 'bridge-error',
      severity: 'critical',
      title: t(locale, 'Something needs your attention.', 'Algo precisa da sua atenção.'),
    });
  }

  if (!hasSession) {
    items.push({
      description: t(
        locale,
        'Open or focus any Power Automate flow so the extension can capture page context safely.',
        'Abra ou foque qualquer fluxo do Power Automate para a extensão capturar o contexto da página com segurança.',
      ),
      id: 'missing-session',
      severity: 'warning',
      title: t(locale, 'Open a flow to get started.', 'Abra um fluxo para começar.'),
    });
  }

  if (selectedTargetMismatch && activeTarget && currentTab) {
    items.push({
      description: t(
        locale,
        `This browser tab is showing ${currentTab.displayName}. The MCP will follow the focused captured tab automatically.`,
        `Esta aba do navegador está mostrando ${currentTab.displayName}. O MCP acompanha automaticamente a aba capturada em foco.`,
      ),
      id: 'target-mismatch',
      severity: 'warning',
      title: t(locale, 'You opened a different flow.', 'Você abriu outro fluxo.'),
    });
  }

  if (hasSession && !hasLegacyApi) {
    items.push({
      description: t(
        locale,
        'The page is connected, but validation and some save operations still need a flow-service token capture.',
        'A página está conectada, mas validação e algumas operações de salvar ainda precisam capturar um token do serviço de fluxo.',
      ),
      id: 'legacy-missing',
      severity: 'warning',
      title: t(locale, 'Almost ready for deeper actions.', 'Quase pronto para ações mais avançadas.'),
    });
  }

  if ((lastRun?.status || '').toLowerCase() === 'failed' && lastRun) {
    items.push({
      description: lastRun.failedActionName
        ? t(
            locale,
            `The latest run failed at ${lastRun.failedActionName}.`,
            `A última execução falhou em ${lastRun.failedActionName}.`,
          )
        : t(
            locale,
            'The latest run failed and needs a closer look.',
            'A última execução falhou e precisa de uma olhada mais cuidadosa.',
          ),
      id: 'last-run-failed',
      severity: 'critical',
      title: t(locale, 'The latest run needs review.', 'A última execução precisa de revisão.'),
    });
  }

  if (lastUpdate?.summary?.changedFlowBody) {
    items.push({
      actionLabel: t(locale, 'Open workspace', 'Abrir espaço de trabalho'),
      actionType: 'open-side-panel',
      description: t(
        locale,
        'This flow has a cached logic change. Review it before making another edit.',
        'Este fluxo tem uma mudança lógica em cache. Revise antes de fazer outra edição.',
      ),
      id: 'logic-updated',
      severity: 'info',
      title: t(locale, 'A recent change is ready to review.', 'Uma mudança recente está pronta para revisão.'),
    });
  }

  if (items.length === 0) {
    items.push({
      description: t(
        locale,
        'The current browser flow and the session are aligned. You can keep working with confidence.',
        'O fluxo atual no navegador e a sessão estão alinhados. Você pode continuar com confiança.',
      ),
      id: 'all-good',
      severity: 'success',
      title: t(locale, 'This flow is ready.', 'Este fluxo está pronto.'),
    });
  }

  return items;
};

export const deriveDashboardModel = (payload: DashboardPayload, locale: Locale = 'en'): DashboardModel => {
  const status = (payload.status || {}) as NonNullable<DashboardPayload['status']>;
  const context = status.context?.context || null;
  const flowCatalog = payload.flowCatalog;
  const catalogFlows = flowCatalog?.flows || [];
  const activeFlow = (
    context ?
      {
        activeTarget: context.selection.activeTarget,
        currentTab: context.selection.currentTab,
      }
    : status.activeFlow || null
  ) as
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

  const primaryFlow = currentTab || activeTarget;
  const lastRun = getSelectedRun(status, primaryFlow);
  const lastUpdate = getSelectedUpdate(status, primaryFlow);
  const selectedTargetMismatch =
    Boolean(activeTarget?.flowId && currentTab?.flowId && activeTarget.flowId !== currentTab.flowId);
  const bridgeOnline = Boolean(status.bridge?.ok);
  const hasSession =
    context?.session.connected ??
    (Boolean(status.session) ||
      Boolean((status.bridge as { hasSession?: boolean } | null)?.hasSession) ||
      Boolean(activeTarget?.flowId));
  const hasLegacyApi =
    context?.capabilities.canUseLegacyApi.available ??
    (Boolean(status.session?.legacyApiUrl && status.session?.legacyToken) ||
      hasLegacyTokenAuditCandidate(status) ||
      Boolean((status.bridge as { hasLegacyApi?: boolean } | null)?.hasLegacyApi));
  const latestCaptureDiagnostic =
    context?.diagnostics.latestCaptureDiagnostic || status.bridge?.latestCaptureDiagnostic || null;
  const error =
    status.error ||
    status.lastError ||
    (context && !context.diagnostics.storeHealth.ok ?
      t(
        locale,
        'One or more local state files are corrupted. Refresh the flow page or clear local state.',
        'Um ou mais arquivos de estado local estão corrompidos. Atualize a página do fluxo ou limpe o estado local.',
      )
    : null);

  const statusLabel = !bridgeOnline
    ? t(locale, 'Offline', 'Offline')
    : !hasSession
      ? t(locale, 'Open a flow', 'Abra um fluxo')
      : selectedTargetMismatch
        ? t(locale, 'Sync available', 'Sincronização disponível')
        : (lastRun?.status || '').toLowerCase() === 'failed'
          ? t(locale, 'Run needs review', 'Execução precisa de revisão')
          : !hasLegacyApi
            ? t(locale, 'Setup needed', 'Configuração pendente')
            : t(locale, 'Connected', 'Conectado');

  const statusMessage = !bridgeOnline
    ? t(locale, 'The extension cannot reach the local bridge right now.', 'A extensão não consegue alcançar a bridge local agora.')
    : !hasSession
      ? t(
          locale,
          'Open or focus a Power Automate flow so we can capture the right context automatically.',
          'Abra ou foque um fluxo do Power Automate para capturarmos o contexto certo automaticamente.',
        )
      : selectedTargetMismatch
        ? t(
            locale,
            'The browser moved to a different flow. The MCP will retarget from the focused captured tab.',
            'O navegador mudou para outro fluxo. O MCP muda o alvo a partir da aba capturada em foco.',
          )
        : (lastRun?.status || '').toLowerCase() === 'failed'
          ? t(
              locale,
              'The latest run failed, so it is safer to review the flow before making more changes.',
              'A última execução falhou, então é mais seguro revisar o fluxo antes de fazer novas mudanças.',
            )
          : !hasLegacyApi
            ? t(
                locale,
                'The flow is visible, but deeper actions still need a fresh compatibility token capture.',
                'O fluxo está visível, mas ações mais profundas ainda precisam de uma nova captura de token de compatibilidade.',
              )
            : t(
                locale,
                'Everything is aligned for safe inspection, review, and follow-up actions.',
                'Tudo está alinhado para inspeção, revisão e próximos passos com segurança.',
              );

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
      locale,
      selectedTargetMismatch,
    }),
    bridgeMode: context?.diagnostics.bridgeMode || status.bridge?.bridgeMode || null,
    bridgeOnline,
    catalogFlows,
    currentTab,
    diagnostics: {
      capturedAt: context?.session.capturedAt || status.session?.capturedAt || status.bridge?.capturedAt || null,
      envId:
        context?.session.envId ||
        context?.selection.resolvedTarget?.envId ||
        status.session?.envId ||
        activeTarget?.envId ||
        currentTab?.envId ||
        null,
      error,
      lastSentAt: status.lastSentAt || null,
      latestCaptureDiagnostic,
      snapshotSource: status.snapshot?.source || null,
      tokenSource: status.tokenMeta?.source || getDiagnosticDetailString(latestCaptureDiagnostic, 'bestSource'),
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
