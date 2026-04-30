import type { ActiveTarget, CaptureDiagnostic, FlowSnapshot, LastRun, LastUpdate, Session, TokenAudit } from './schemas.js';

export type BridgeMode = 'owned' | 'reused';
export type CapabilityReasonCode =
  | 'AUTHENTICATION_FAILED'
  | 'CONNECTION_AUTHORIZATION_FAILED'
  | 'LEGACY_TOKEN_MISSING'
  | 'NO_SESSION'
  | 'NO_TARGET'
  | 'SESSION_READY'
  | 'STORE_CORRUPTED'
  | 'TARGET_AMBIGUOUS'
  | 'TARGET_READY';

export type StoreState = 'corrupted' | 'migrated' | 'missing' | 'ok';

export interface CapabilityStatus {
  available: boolean;
  reason: string | null;
  reasonCode: CapabilityReasonCode | null;
}

export interface PowerAutomateCapabilities {
  canReadFlow: CapabilityStatus;
  canReadFlows: CapabilityStatus;
  canReadRuns: CapabilityStatus;
  canUpdateFlow: CapabilityStatus;
  canUseLegacyApi: CapabilityStatus;
  canValidateFlow: CapabilityStatus;
}

export interface StoreHealthItem {
  filePath: string;
  loadedAt: string;
  message: string | null;
  name: string;
  state: StoreState;
  version: number | null;
}

export interface ContextSelection {
  activeTarget: ActiveTarget | null;
  capturedSessions: CapturedSessionSummary[];
  currentTab: {
    displayName: string | null;
    envId: string | null;
    flowId: string | null;
  } | null;
  resolvedTarget: {
    displayName: string | null;
    envId: string | null;
    flowId: string | null;
    selectedAt: string | null;
    selectionSource: string | null;
  } | null;
  selectedWorkSession: CapturedSessionSummary | null;
}

export interface CapturedSessionSummary {
  capturedAt: string;
  displayName: string | null;
  envId: string;
  flowId: string;
  hasLegacyApi: boolean;
  isSelected: boolean;
  lastSeenAt: string;
  portalUrl: string | null;
  tabId: number;
}

export interface PowerAutomateContext {
  capabilities: PowerAutomateCapabilities;
  diagnostics: {
    bridgeMode: BridgeMode;
    envId: string | null;
    lastRunCapturedAt: string | null;
    lastUpdateCapturedAt: string | null;
    latestCaptureDiagnostic: CaptureDiagnostic | null;
    legacySource: string | null;
    snapshotCapturedAt: string | null;
    storeHealth: {
      items: StoreHealthItem[];
      ok: boolean;
    };
    tokenAuditCapturedAt: string | null;
  };
  selection: ContextSelection;
  session: {
    capturedAt: string | null;
    connected: boolean;
    envId: string | null;
    flowId: string | null;
    portalUrl: string | null;
  };
}

export interface HealthPayload {
  activeTarget: ActiveTarget | null;
  blockedReason: CapabilityStatus | null;
  capturedAt: string | null;
  bridgeMode: BridgeMode;
  currentTabFlowId: string | null;
  envId: string | null;
  hasLegacyApi: boolean;
  hasLastRun: boolean;
  hasLastUpdate: boolean;
  hasSession: boolean;
  hasSnapshot: boolean;
  hasTokenAudit: boolean;
  latestCaptureDiagnostic: CaptureDiagnostic | null;
  instanceId: string;
  lastRunCapturedAt: string | null;
  lastUpdateCapturedAt: string | null;
  ok: true;
  pid: number;
  port: number;
  snapshotCapturedAt: string | null;
  startedAt: string;
  tokenAuditCapturedAt: string | null;
  version: string;
}

export interface ContextPayload {
  context: PowerAutomateContext;
  lastRun: LastRun | null;
  lastUpdate: LastUpdate | null;
  ok: true;
}

export interface CapturedSessionsPayload {
  sessions: CapturedSessionSummary[];
  selectedTabId: number | null;
  ok: true;
}

export interface SelectWorkTabResponse {
  selectedTabId: number;
  ok: true;
}

export interface SessionCaptureResponse {
  capturedAt: string;
  envId: string;
  flowId: string;
  hasLegacyApi: boolean;
  ok: true;
}

export interface SnapshotCaptureResponse {
  capturedAt: string;
  envId: string;
  flowId: string;
  ok: true;
  source: string;
}

export interface TokenAuditResponse {
  candidateCount: number;
  capturedAt: string;
  flowId: string | null;
  ok: true;
  source: string;
}

export interface LastUpdateResponse {
  lastUpdate: LastUpdate | null;
  ok: true;
}

export interface LastRunResponse {
  lastRun: LastRun | null;
  ok: true;
}

export interface FlowsResponse {
  flows: unknown;
  ok: true;
}

export interface ActiveFlowResponse {
  activeFlow: unknown;
  ok: true;
}

export interface RefreshLastRunResponse {
  lastRun: LastRun;
  ok: true;
}

export interface RevertLastUpdateResponse {
  flowId: string;
  ok: true;
  reverted: unknown;
}

export interface BridgeErrorResponse {
  blockedByUserAction?: boolean;
  code?: string;
  details?: unknown;
  error: string;
  retryable?: boolean;
}

export interface PopupTokenMeta {
  score: number;
  scope: string;
  source: string;
}

export interface PopupStatusPayload {
  activeFlow: unknown | null;
  bridge: Partial<HealthPayload> & { ok?: boolean; error?: string | null } | null;
  context: ContextPayload | null;
  error?: string;
  lastError: string | null;
  lastRun: LastRun | null;
  lastSentAt: string | null;
  lastUpdate: LastUpdate | null;
  session: Session | null;
  snapshot: FlowSnapshot | null;
  tokenAudit: TokenAudit | null;
  tokenMeta: PopupTokenMeta | null;
}
