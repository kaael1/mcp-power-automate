#!/usr/bin/env node
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ZodError } from 'zod';

import { commandDefinitions, executeCommand, getCommandDefinition } from './command-registry.js';
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
import { getLatestCaptureDiagnostic, getLatestCaptureDiagnosticForFlow, loadCaptureDiagnostics, saveCaptureDiagnostic } from './capture-diagnostics-store.js';
import { listCapturedSessions, loadCapturedSessions, removeCapturedSession, upsertCapturedSession } from './captured-sessions-store.js';
import { loadFlowCatalog } from './flow-catalog-store.js';
import { getFlowSnapshot, getFlowSnapshotForFlow, loadFlowSnapshot, saveFlowSnapshot } from './flow-snapshot-store.js';
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
import { getPackageRoot } from './runtime-paths.js';
import { bridgeHost, bridgePort, capturedSessionSchema, captureDiagnosticSchema, flowIdSchema, flowSnapshotSchema, selectWorkTabInputSchema, sessionSchema, tokenAuditSchema } from './schemas.js';
import { getSession, loadSession, saveSession } from './session-store.js';
import { clearSelectedWorkTab, getSelectedWorkTab, loadSelectedWorkTab, saveSelectedWorkTab } from './selected-work-tab-store.js';
import { getTokenAudit, loadTokenAudit, saveTokenAudit } from './token-audit-store.js';
import { hasLegacyCompatibleToken } from './token-compat.js';
import { createMcpApp } from './tools.js';
import { getBridgeRuntimeInfo, setBridgeMode } from './runtime-state.js';
import { getLastUpdate, loadLastUpdate } from './update-history-store.js';
import { packageVersion } from './version.js';

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
    blockedByUserAction: payload.blockedByUserAction,
    code: payload.code,
    details: payload.details,
    error: payload.message,
    retryable: payload.retryable,
  };
};

const normalizeAudience = (audience: unknown) =>
  typeof audience === 'string' ? audience.replace(/\/+$/, '').toLowerCase() : '';

const hasLegacyTokenAuditCandidate = () => {
  const tokenAudit = getTokenAudit();

  return Boolean(
    tokenAudit?.candidates?.some(
      (candidate) =>
        normalizeAudience(candidate.aud) === 'https://service.flow.microsoft.com' ||
        normalizeAudience(candidate.aud) === 'https://service.powerapps.com',
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
  const runtime = getBridgeRuntimeInfo();
  const context = getContextPayload({ bridgeMode: ownsBridgeServer ? 'owned' : 'reused' }).context;
  const targetSnapshot =
    context.selection.resolvedTarget?.envId && context.selection.resolvedTarget.flowId ?
      getFlowSnapshotForFlow({
        envId: context.selection.resolvedTarget.envId,
        flowId: context.selection.resolvedTarget.flowId,
      })
    : snapshot;
  const latestCaptureDiagnostic =
    context.selection.resolvedTarget?.envId && context.selection.resolvedTarget.flowId ?
      getLatestCaptureDiagnosticForFlow({
        envId: context.selection.resolvedTarget.envId,
        flowId: context.selection.resolvedTarget.flowId,
      }) || getLatestCaptureDiagnostic()
    : getLatestCaptureDiagnostic();
  const blockedReason =
    [
      context.capabilities.canReadFlows,
      context.capabilities.canReadFlow,
      context.capabilities.canUseLegacyApi,
      context.capabilities.canValidateFlow,
      context.capabilities.canUpdateFlow,
    ].find((capability) => !capability.available) || null;

  return {
    activeTarget,
    blockedReason,
    capturedAt: session?.capturedAt || null,
    bridgeMode: ownsBridgeServer ? 'owned' : 'reused',
    currentTabFlowId: session?.flowId || null,
    envId: session?.envId || activeTarget?.envId || null,
    hasLegacyApi: hasLegacyCompatibleAccess(session),
    hasLastUpdate: Boolean(lastUpdate),
    hasLastRun: Boolean(lastRun?.run),
    hasSnapshot: Boolean(targetSnapshot),
    hasSession: Boolean(session),
    hasTokenAudit: Boolean(tokenAudit),
    latestCaptureDiagnostic,
    instanceId: runtime.instanceId,
    lastUpdateCapturedAt: lastUpdate?.capturedAt || null,
    lastRunCapturedAt: lastRun?.capturedAt || null,
    ok: true,
    pid: runtime.pid,
    port: runtime.port,
    snapshotCapturedAt: targetSnapshot?.capturedAt || null,
    startedAt: runtime.startedAt,
    tokenAuditCapturedAt: tokenAudit?.capturedAt || null,
    version: runtime.version,
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
      const isV1 = requestUrl.pathname === '/v1' || requestUrl.pathname.startsWith('/v1/');
      const normalizedPath = isV1 ? requestUrl.pathname.replace(/^\/v1(?=\/|$)/, '') || '/' : requestUrl.pathname;

      if (request.method === 'OPTIONS') {
        sendJson(response, 204, { ok: true });
        return;
      }

      if (request.method === 'GET' && (requestUrl.pathname === '/health' || requestUrl.pathname === '/v1/health')) {
        sendJson(response, 200, createHealthPayload());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/v1/commands') {
        sendJson(response, 200, {
          commands: commandDefinitions.map(({ description, name, risk }) => ({ description, name, risk })),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname.startsWith('/v1/commands/')) {
        const commandName = decodeURIComponent(requestUrl.pathname.replace('/v1/commands/', ''));
        if (!getCommandDefinition(commandName)) {
          sendJson(response, 404, { code: 'INVALID_REQUEST', error: `Unknown command: ${commandName}`, retryable: false } satisfies BridgeErrorResponse);
          return;
        }

        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await executeCommand(commandName, body, { local: true }),
        });
        return;
      }

      if (request.method === 'GET' && normalizedPath === '/context') {
        sendJson(response, 200, (await executeCommand('get_context', {}, { local: true })) as ContextPayload);
        return;
      }

      if (request.method === 'GET' && normalizedPath === '/captured-sessions') {
        sendJson(response, 200, {
          ok: true,
          selectedTabId: getSelectedWorkTab()?.tabId || null,
          sessions: listCapturedTabs(),
        } satisfies CapturedSessionsPayload);
        return;
      }

      if (request.method === 'GET' && normalizedPath === '/last-update') {
        sendJson(response, 200, {
          lastUpdate: getLastUpdateSummary(),
          ok: true,
        } satisfies LastUpdateResponse);
        return;
      }

      if (request.method === 'GET' && normalizedPath === '/last-run') {
        sendJson(response, 200, {
          lastRun: getLastRunSummary(),
          ok: true,
        } satisfies LastRunResponse);
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/session') {
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

      if (request.method === 'POST' && normalizedPath === '/captured-session') {
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

      if (request.method === 'POST' && normalizedPath === '/captured-session/remove') {
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

      if (request.method === 'POST' && normalizedPath === '/snapshot') {
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

      if (request.method === 'POST' && normalizedPath === '/token-audit') {
        const body = await readJsonBody(request);
        const audit = tokenAuditSchema.parse(body);
        const savedAudit = await saveTokenAudit(audit);
        sendJson(response, 200, {
          candidateCount: savedAudit.candidates.length,
          capturedAt: savedAudit.capturedAt,
          flowId: savedAudit.flowId || null,
          ok: true,
          source: savedAudit.source,
        } satisfies TokenAuditResponse);
        return;
      }

      if (request.method === 'GET' && normalizedPath === '/flows') {
        sendJson(response, 200, {
          flows: await listFlows({ limit: 200 }),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/refresh-flows') {
        sendJson(response, 200, {
          flows: await refreshFlows(),
          ok: true,
        });
        return;
      }

      if (request.method === 'GET' && normalizedPath === '/active-flow') {
        sendJson(response, 200, {
          activeFlow: await getActiveFlow(),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/active-flow') {
        const body = await readJsonBody(request);
        const flowId = flowIdSchema.parse((body as { flowId?: string }).flowId);
        sendJson(response, 200, {
          activeFlow: await selectFlow({ flowId }),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/capture-diagnostics') {
        const body = await readJsonBody(request);
        const diagnostic = captureDiagnosticSchema.parse(body);
        const saved = await saveCaptureDiagnostic(diagnostic);
        sendJson(response, 200, {
          capturedAt: saved.capturedAt,
          ok: true,
          source: saved.source,
          stage: saved.stage,
          status: saved.status,
        });
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/active-flow/from-tab') {
        sendJson(response, 200, {
          activeFlow: await selectTabFlow(),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/select-flow') {
        const body = await readJsonBody(request);
        const flowId = flowIdSchema.parse((body as { flowId?: string }).flowId);
        sendJson(response, 200, {
          activeFlow: await selectFlow({ flowId }),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/select-flow/from-tab') {
        sendJson(response, 200, {
          activeFlow: await selectTabFlow(),
          ok: true,
        });
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/selected-work-tab') {
        const body = await readJsonBody(request);
        const parsed = selectWorkTabInputSchema.parse(body);
        const selected = await selectWorkTab({ tabId: parsed.tabId });
        sendJson(response, 200, {
          ok: true,
          selectedTabId: selected.selectedWorkSession.tabId,
        } satisfies SelectWorkTabResponse);
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/revert-last-update') {
        const reverted = await revertLastUpdate();
        sendJson(response, 200, {
          flowId: reverted.flow.flowId,
          ok: true,
          reverted,
        } satisfies RevertLastUpdateResponse);
        return;
      }

      if (request.method === 'POST' && normalizedPath === '/refresh-last-run') {
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

const loadLocalState = async () => {
  await loadCapturedSessions();
  await loadSelectedWorkTab();
  await loadSession();
  await loadActiveTarget();
  await loadFlowCatalog();
  await loadFlowSnapshot();
  await loadLastRun();
  await loadTokenAudit();
  await loadCaptureDiagnostics();
  await loadLastUpdate();
};

const handleCli = async () => {
  const command = process.argv[2];

  if (!command) return false;

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(packageVersion);
    return true;
  }

  if (command === 'extension-path') {
    console.log(path.join(getPackageRoot(), 'dist', 'extension'));
    return true;
  }

  if (command === 'doctor') {
    const bridgeHealth = await probeExistingBridge();
    if (bridgeHealth) {
      console.log(JSON.stringify({ bridge: bridgeHealth, ok: true }, null, 2));
      return true;
    }

    await loadLocalState();
    console.log(
      JSON.stringify(
        {
          bridge: getBridgeRuntimeInfo(),
          health: createHealthPayload(),
          ok: true,
        },
        null,
        2,
      ),
    );
    return true;
  }

  console.error(`Unknown command "${command}". Use doctor, extension-path, or version.`);
  process.exitCode = 1;
  return true;
};

const ensureBridgeServer = async () => {
  try {
    await listen(bridgeServer, bridgeHost, bridgePort);
    ownsBridgeServer = true;
    setBridgeMode('owned');
    return { mode: 'owned' as const };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') {
      throw error;
    }

    const healthyBridge = await probeExistingBridge();

    if (healthyBridge) {
      ownsBridgeServer = false;
      setBridgeMode('reused');
      return { health: healthyBridge, mode: 'reused' as const };
    }

    throw new Error(
      `Bridge port ${bridgePort} is already in use, but no healthy bridge answered on ${getBridgeHealthUrl()}. Stop the stale process or choose another POWER_AUTOMATE_BRIDGE_PORT.`,
      { cause: error },
    );
  }
};

const main = async () => {
  if (await handleCli()) return;

  await loadLocalState();
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
