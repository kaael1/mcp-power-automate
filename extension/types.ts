import type { PopupStatusPayload, PopupTokenMeta } from '../server/bridge-types.js';
import type { CaptureDiagnostic, FlowCatalog, FlowCatalogItem, FlowSnapshot, Session, TokenAudit } from '../server/schemas.js';

export const BRIDGE_SIGNAL = 'pa-mcp-bridge';
export const BRIDGE_URL = 'http://127.0.0.1:17373/v1';

export const STORAGE_KEYS = {
  activeFlow: 'mcpPowerAutomate.activeFlow',
  flowCatalog: 'mcpPowerAutomate.flowCatalog',
  lastError: 'mcpPowerAutomate.lastError',
  lastHealth: 'mcpPowerAutomate.lastHealth',
  lastContext: 'mcpPowerAutomate.lastContext',
  lastRun: 'mcpPowerAutomate.lastRun',
  lastUpdate: 'mcpPowerAutomate.lastUpdate',
  lastSentAt: 'mcpPowerAutomate.lastSentAt',
  lastSession: 'mcpPowerAutomate.lastSession',
  lastSnapshot: 'mcpPowerAutomate.lastSnapshot',
  tokenAudit: 'mcpPowerAutomate.tokenAudit',
  tokenMeta: 'mcpPowerAutomate.tokenMeta',
  pinnedFlowIds: 'mcpPowerAutomate.pinnedFlowIds',
  recentFlowIds: 'mcpPowerAutomate.recentFlowIds',
} as const;

export interface BackgroundTabState {
  apiToken?: string;
  apiTokenMeta?: PopupTokenMeta;
  apiUrl?: string;
  envId?: string;
  flowId?: string;
  legacyApiUrl?: string;
  legacyToken?: string;
  portalUrl?: string;
}

export interface BackgroundState {
  lastSentSignatures: Record<number, string>;
  tabs: Record<number, BackgroundTabState>;
}

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export type StorageShape = Partial<Record<StorageKey, unknown>>;

export interface FlowCatalogPayload extends Omit<FlowCatalog, 'flows'> {
  flows: FlowCatalogItem[];
  message?: string;
  total?: number;
}

export interface DashboardPayload {
  flowCatalog: FlowCatalogPayload | null;
  pinnedFlowIds: string[];
  recentFlowIds: string[];
  status: PopupStatusPayload;
}

export type FlowSnapshotMessage = {
  payload: FlowSnapshot;
  source: string;
  type: 'flow-snapshot';
};

export type TokenAuditMessage = {
  payload: TokenAudit;
  source: string;
  type: 'token-audit';
};

export type TokenFromStorageMessage = {
  score?: number;
  scope?: string;
  source: string;
  token: string;
  tokenSource?: string;
  type: 'token-from-storage';
};

export type TokenFromMsalMessage = {
  score?: number;
  scope?: string;
  source: string;
  token: string;
  tokenSource?: string;
  type: 'token-from-msal';
};

export type CaptureDiagnosticMessage = {
  payload: CaptureDiagnostic;
  source: string;
  type: 'capture-diagnostics';
};

export type PopupRequestMessage =
  | { type: 'get-status' }
  | { type: 'get-dashboard' }
  | { type: 'open-side-panel' };

export type RuntimeMessage =
  | CaptureDiagnosticMessage
  | FlowSnapshotMessage
  | TokenAuditMessage
  | TokenFromStorageMessage
  | TokenFromMsalMessage
  | PopupRequestMessage;

export interface PersistSessionStatusInput {
  error?: string | null;
  health?: { error?: string; ok?: boolean } | Record<string, unknown> | null;
  sentAt?: string | null;
  session?: Session | null;
}

export type { PopupStatusPayload, PopupTokenMeta };
