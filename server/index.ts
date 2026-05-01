#!/usr/bin/env node
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ZodError } from 'zod';

import type {
  BridgeErrorResponse,
  CapturedSessionsPayload,
  ContextPayload,
  HealthPayload,
  LastRunResponse,
  LastUpdateResponse,
  RefreshLastRunResponse,
  RevertLastUpdateResponse,
  SessionCaptureResponse,
  SelectWorkTabResponse,
  SnapshotCaptureResponse,
  TokenAuditResponse,
} from './bridge-types.js';
import { getActiveTarget, loadActiveTarget, saveActiveTarget } from './active-target-store.js';
import { listCapturedSessions, loadCapturedSessions, removeCapturedSession, upsertCapturedSession } from './captured-sessions-store.js';
import { loadDataverseOrgMap } from './dataverse-org-store.js';
import { loadFlowCatalog } from './flow-catalog-store.js';
import { getFlowSnapshot, loadFlowSnapshot, saveFlowSnapshot } from './flow-snapshot-store.js';
import {
  getActiveFlow,
  getContextPayload,
  getLastRunSummary,
  getLastUpdateSummary,
  listFlows,
  refreshFlows,
  refreshLatestRun,
  revertLastUpdate,
  listCapturedTabs,
  selectFlow,
  selectWorkTab,
  selectTabFlow,
} from './power-automate-client.js';
import { toErrorPayload } from './errors.js';
import { getLastRun, loadLastRun } from './last-run-store.js';
import { bridgeHost, bridgePort, capturedSessionSchema, flowIdSchema, flowSnapshotSchema, selectWorkTabInputSchema, sessionSchema, tokenAuditSchema } from './schemas.js';
import { getSession, loadSession, saveSession } from './session-store.js';
import { clearSelectedWorkTab, getSelectedWorkTab, loadSelectedWorkTab, saveSelectedWorkTab } from './selected-work-tab-store.js';
import { getTokenAudit, loadTokenAudit, saveTokenAudit } from './token-audit-store.js';
import { hasLegacyCompatibleToken } from './token-compat.js';
import { createMcpApp } from './tools.js';
import { getLastUpdate, loadLastUpdate } from './update-history-store.js';

const mcpServer = createMcpApp();
let ownsBridgeServer = false;

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
};

const readJsonBody = async (request: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      try {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        resolve(bodyText ? JSON.parse(bodyText) : {});
      } catch (error) {
        reject(error);
      }
    });
  });

const toBridgeErrorResponse = (error: unknown): BridgeErrorResponse => {
  const payload = toErrorPayload(error);

  return {
    code: payload.code,
    details: payload.details,
    error: payload.message,
    retryable: payload.retryable,
  };
};

const hasLegacyTokenAuditCandidate = () => {
  const tokenAudit = getTokenAudit();

  return Boolean(
    tokenAudit?.candidates?.some(
      (candidate) =>
        candidate.aud === 'https://service.flow.microsoft.com/' ||
        candidate.aud === 'https://service.powerapps.com/',
    ),
  );
};

const hasLegacyCompatibleAccess = (session = getSession()) =>
  Boolean(
    (session?.legacyApiUrl && session?.legacyToken) ||
      hasLegacyCompatibleToken(session?.apiToken) ||
      hasLegacyTokenAuditCandidate(),
  );

export const createHealthPayload = (): HealthPayload => {
  const session = getSession();
  const lastRun = getLastRun();
  const snapshot = getFlowSnapshot();
  const tokenAudit = getTokenAudit();
  const lastUpdate = getLastUpdate();
  const activeTarget = getActiveTarget(session?.envId);

  return {
    activeTarget,
    capturedAt: session?.capturedAt || null,
    bridgeMode: ownsBridgeServer ? 'owned' : 'reused',
    currentTabFlowId: session?.flowId || null,
    envId: session?.envId || activeTarget?.envId || null,
    hasLegacyApi: hasLegacyCompatibleAccess(session),
    hasLastUpdate: Boolean(lastUpdate),
    hasLastRun: Boolean(lastRun?.run),
    hasSnapshot: Boolean(snapshot),
    hasSession: Boolean(session),
    hasTokenAudit: Boolean(tokenAudit),
    lastUpdateCapturedAt: lastUpdate?.capturedAt || null,
    lastRunCapturedAt: lastRun?.capturedAt || null,
    ok: true,
    snapshotCapturedAt: snapshot?.capturedAt || null,
    tokenAuditCapturedAt: tokenAudit?.capturedAt || null,
  };
};

export const createBridgeServer = () =>
  http.createServer(async (request, response) => {
    try {
      if (!request.url) {
        sendJson(response, 400, { error: 'Missing request URL.' } satisfies BridgeErrorResponse);
        return;
      }

      const requestUrl = new URL(request.url, `http://${bridgeHost}:${bridgePort}`);

      if (request.method === 'OPTIONS') {
        sendJson(response, 204, { ok: true });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, createHealthPayload());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/context') {
        sendJson(response, 200, getContextPayload({ bridgeMode: ownsBridgeServer ? 'owned' : 'reused' }) satisfies ContextPayload);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/captured-sessions') {
        sendJson(response, 200, {
          ok: true,
          selectedTabId: getSelectedWorkTab()?.tabId || null,
          sessions: listCapturedTabs(),
        } satisfies CapturedSessionsPayload);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/last-update') {
        sendJson(response, 200, {
          lastUpdate: getLastUpdateSummary(),
          ok: true,
        } satisfies LastUpdateResponse);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/last-run') {
        sendJson(response, 200, {
          lastRun: getLastRunSummary(),
          ok: true,
        } satisfies LastRunResponse);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/session') {
        const body = await readJsonBody(request);
        const session = sessionSchema.parse(body);
        const savedSession = await saveSession(session);
        const existingTarget = getActiveTarget(savedSession.envId);

        if (!existingTarget || existingTarget.envId !== savedSession.envId) {
          await saveActiveTarget({
            displayName: null,
            envId: savedSession.envId,
            flowId: savedSession.flowId,
            selectedAt: new Date().toISOString(),
            selectionSource: 'tab-capture',
          });
        }

        sendJson(response, 200, {
          capturedAt: savedSession.capturedAt,
          envId: savedSession.envId,
          flowId: savedSession.flowId,
          hasLegacyApi: hasLegacyCompatibleAccess(savedSession),
          ok: true,
        } satisfies SessionCaptureResponse);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/captured-session') {
        const body = await readJsonBody(request);
        const capturedSession = capturedSessionSchema.parse(body);
        const savedSession = await upsertCapturedSession(capturedSession);
        const selectedWorkTab = getSelectedWorkTab();

        if (!selectedWorkTab && listCapturedSessions().length === 1) {
          await saveSelectedWorkTab({
            selectedAt: new Date().toISOString(),
            tabId: savedSession.tabId,
          });
        }

        const effectiveSelectedTabId = getSelectedWorkTab()?.tabId || null;

        if (effectiveSelectedTabId === savedSession.tabId && !getActiveTarget(savedSession.envId)) {
          await saveActiveTarget({
            displayName: null,
            envId: savedSession.envId,
            flowId: savedSession.flowId,
            selectedAt: new Date().toISOString(),
            selectionSource: 'tab-capture',
          });
        }

        sendJson(response, 200, {
          capturedAt: savedSession.capturedAt,
          envId: savedSession.envId,
          flowId: savedSession.flowId,
          hasLegacyApi: hasLegacyCompatibleAccess(savedSession),
          ok: true,
        } satisfies SessionCaptureResponse);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/captured-session/remove') {
        const body = await readJsonBody(request);
        const parsed = selectWorkTabInputSchema.parse(body);
        const selectedWorkTab = getSelectedWorkTab();
        await removeCapturedSession(parsed.tabId);

        if (selectedWorkTab?.tabId === parsed.tabId) {
          await clearSelectedWorkTab();
        }

        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/snapshot') {
        const body = await readJsonBody(request);
        const snapshot = flowSnapshotSchema.parse(body);
        const savedSnapshot = await saveFlowSnapshot(snapshot);
        sendJson(response, 200, {
          capturedAt: savedSnapshot.capturedAt,
          envId: savedSnapshot.envId,
          flowId: savedSnapshot.flowId,
          ok: true,
          source: savedSnapshot.source,
        } satisfies SnapshotCaptureResponse);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/token-audit') {
        const body = await readJsonBody(request);
        const audit = tokenAuditSchema.parse(body);
        // Merge with existing audit so single-candidate POSTs from auxiliary
        // sources (BAP / Dataverse webRequest captures) accumulate alongside
        // full storage scans rather than overwriting them. Keep newest 50.
        // Audit-level metadata (envId, flowId, portalUrl) is preserved from
        // the existing audit when the incoming POST lacks it; auxiliary
        // events frequently leave envId/flowId blank because they fire on
        // origins outside the Power Automate maker portal.
        // Expired candidates are also evicted at insert time so the 50-slot
        // cap doesn't fill with stale tokens.
        const nowSeconds = Math.floor(Date.now() / 1000);
        const isLive = (candidate: typeof audit.candidates[number]) =>
          typeof candidate.exp !== 'number' || candidate.exp > nowSeconds;
        const existing = getTokenAudit();
        const seen = new Set<string>();
        const merged: typeof audit.candidates = [];
        for (const candidate of audit.candidates) {
          if (seen.has(candidate.token)) continue;
          if (!isLive(candidate)) continue;
          seen.add(candidate.token);
          merged.push(candidate);
        }
        for (const candidate of existing?.candidates ?? []) {
          if (seen.has(candidate.token)) continue;
          if (!isLive(candidate)) continue;
          seen.add(candidate.token);
          merged.push(candidate);
        }
        const savedAudit = await saveTokenAudit({
          ...audit,
          envId: audit.envId ?? existing?.envId,
          flowId: audit.flowId ?? existing?.flowId,
          portalUrl: audit.portalUrl ?? existing?.portalUrl,
          candidates: merged.slice(0, 50),
        });
        sendJson(response, 200, {
          candidateCount: savedAudit.candidates.length,
          capturedAt: savedAudit.capturedAt,
          flowId: savedAudit.flowId || null,
          ok: true,
          source: savedAudit.source,
        } satisfies TokenAuditResponse);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/flows') {
        sendJson(response, 200, {
          flows: await listFlows({ limit: 200 }),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/refresh-flows') {
        sendJson(response, 200, {
          flows: await refreshFlows(),
          ok: true,
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/active-flow') {
        sendJson(response, 200, {
          activeFlow: await getActiveFlow(),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/active-flow') {
        const body = await readJsonBody(request);
        const flowId = flowIdSchema.parse((body as { flowId?: string }).flowId);
        sendJson(response, 200, {
          activeFlow: await selectFlow({ flowId }),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/active-flow/from-tab') {
        sendJson(response, 200, {
          activeFlow: await selectTabFlow(),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/select-flow') {
        const body = await readJsonBody(request);
        const flowId = flowIdSchema.parse((body as { flowId?: string }).flowId);
        sendJson(response, 200, {
          activeFlow: await selectFlow({ flowId }),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/select-flow/from-tab') {
        sendJson(response, 200, {
          activeFlow: await selectTabFlow(),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/selected-work-tab') {
        const body = await readJsonBody(request);
        const parsed = selectWorkTabInputSchema.parse(body);
        const selected = await selectWorkTab({ tabId: parsed.tabId });
        sendJson(response, 200, {
          ok: true,
          selectedTabId: selected.selectedWorkSession.tabId,
        } satisfies SelectWorkTabResponse);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/revert-last-update') {
        const reverted = await revertLastUpdate();
        sendJson(response, 200, {
          flowId: reverted.flow.flowId,
          ok: true,
          reverted,
        } satisfies RevertLastUpdateResponse);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/refresh-last-run') {
        const lastRun = await refreshLatestRun();
        sendJson(response, 200, {
          lastRun,
          ok: true,
        } satisfies RefreshLastRunResponse);
        return;
      }

      sendJson(response, 404, { error: 'Route not found.' } satisfies BridgeErrorResponse);
    } catch (error) {
      if (error instanceof ZodError) {
        sendJson(response, 400, {
          code: 'INVALID_REQUEST',
          details: error.issues,
          error: 'Invalid request payload.',
          retryable: false,
        } satisfies BridgeErrorResponse);
        return;
      }

      sendJson(response, 500, toBridgeErrorResponse(error));
    }
  });

const bridgeServer = createBridgeServer();

const listen = (httpServer: Server, host: string, port: number) =>
  new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

const closeHttpServer = async () => {
  if (!ownsBridgeServer) return;

  await new Promise<void>((resolve) => {
    bridgeServer.close(() => resolve());
  });
};

const getBridgeHealthUrl = () => `http://${bridgeHost}:${bridgePort}/health`;

const probeExistingBridge = async () => {
  try {
    const response = await fetch(getBridgeHealthUrl());

    if (!response.ok) return null;

    const body = (await response.json()) as { ok?: boolean };
    return body?.ok ? body : null;
  } catch {
    return null;
  }
};

const ensureBridgeServer = async () => {
  try {
    await listen(bridgeServer, bridgeHost, bridgePort);
    ownsBridgeServer = true;
    return { mode: 'owned' as const };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') {
      throw error;
    }

    const healthyBridge = await probeExistingBridge();

    if (healthyBridge) {
      ownsBridgeServer = false;
      return { health: healthyBridge, mode: 'reused' as const };
    }

    throw new Error(
      `Bridge port ${bridgePort} is already in use, but no healthy bridge answered on ${getBridgeHealthUrl()}. Stop the stale process or choose another POWER_AUTOMATE_BRIDGE_PORT.`,
      { cause: error },
    );
  }
};

const main = async () => {
  await loadCapturedSessions();
  await loadSelectedWorkTab();
  await loadSession();
  await loadActiveTarget();
  await loadFlowCatalog();
  await loadFlowSnapshot();
  await loadLastRun();
  await loadTokenAudit();
  await loadLastUpdate();
  await loadDataverseOrgMap();
  await ensureBridgeServer();

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
};

process.on('SIGINT', async () => {
  await closeHttpServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeHttpServer();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(error);
});

process.on('unhandledRejection', (error) => {
  console.error(error);
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
