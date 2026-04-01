import type {
  ActiveTarget,
  FlowSnapshot,
  LastRun,
  LastUpdate,
  Session,
  TokenAudit,
} from './schemas.js';

export type BridgeMode = 'owned' | 'reused';

export interface HealthPayload {
  activeTarget: ActiveTarget | null;
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
  lastRunCapturedAt: string | null;
  lastUpdateCapturedAt: string | null;
  ok: true;
  snapshotCapturedAt: string | null;
  tokenAuditCapturedAt: string | null;
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
  details?: unknown;
  error: string;
}

export interface PopupTokenMeta {
  score: number;
  scope: string;
  source: string;
}

export interface PopupStatusPayload {
  activeFlow: unknown | null;
  bridge: Partial<HealthPayload> & { ok?: boolean; error?: string | null } | null;
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
