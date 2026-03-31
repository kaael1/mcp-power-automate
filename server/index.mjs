#!/usr/bin/env node
import http from 'node:http';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ZodError } from 'zod';

import { bridgeHost, bridgePort, flowIdSchema, flowSnapshotSchema, sessionSchema, tokenAuditSchema } from './schemas.mjs';
import { getActiveTarget, loadActiveTarget, saveActiveTarget } from './active-target-store.mjs';
import { loadFlowCatalog } from './flow-catalog-store.mjs';
import { loadFlowSnapshot, saveFlowSnapshot, getFlowSnapshot } from './flow-snapshot-store.mjs';
import {
  getActiveFlow,
  getLastRunSummary,
  getLastUpdateSummary,
  listFlows,
  refreshFlows,
  refreshLatestRun,
  revertLastUpdate,
  setActiveFlow,
  setActiveFlowFromTab,
} from './power-automate-client.mjs';
import { getLastRun, loadLastRun } from './last-run-store.mjs';
import { loadSession, saveSession, getSession } from './session-store.mjs';
import { loadTokenAudit, saveTokenAudit, getTokenAudit } from './token-audit-store.mjs';
import { loadLastUpdate, getLastUpdate } from './update-history-store.mjs';
import { createMcpApp } from './tools.mjs';

const mcpServer = createMcpApp();
let ownsBridgeServer = false;

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
};

const readJsonBody = async (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
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

const createHealthPayload = () => {
  const session = getSession();
  const lastRun = getLastRun();
  const snapshot = getFlowSnapshot();
  const tokenAudit = getTokenAudit();
  const lastUpdate = getLastUpdate();
  const activeTarget = getActiveTarget();

  return {
    activeTarget,
    capturedAt: session?.capturedAt || null,
    bridgeMode: ownsBridgeServer ? 'owned' : 'reused',
    currentTabFlowId: session?.flowId || null,
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

const bridgeServer = http.createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: 'Missing request URL.' });
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

    if (request.method === 'GET' && requestUrl.pathname === '/last-update') {
      sendJson(response, 200, {
        lastUpdate: getLastUpdateSummary(),
        ok: true,
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/last-run') {
      sendJson(response, 200, {
        lastRun: getLastRunSummary(),
        ok: true,
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/session') {
      const body = await readJsonBody(request);
      const session = sessionSchema.parse(body);
      const savedSession = await saveSession(session);
      const existingTarget = getActiveTarget();

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
        hasLegacyApi: Boolean(savedSession.legacyApiUrl && savedSession.legacyToken),
        ok: true,
      });
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
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/token-audit') {
      const body = await readJsonBody(request);
      const audit = tokenAuditSchema.parse(body);
      const savedAudit = await saveTokenAudit(audit);
      sendJson(response, 200, {
        candidateCount: savedAudit.candidates.length,
        capturedAt: savedAudit.capturedAt,
        flowId: savedAudit.flowId || null,
        ok: true,
        source: savedAudit.source,
      });
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
      const flowId = flowIdSchema.parse(body.flowId);
      sendJson(response, 200, {
        activeFlow: await setActiveFlow({ flowId }),
        ok: true,
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/active-flow/from-tab') {
      sendJson(response, 200, {
        activeFlow: await setActiveFlowFromTab(),
        ok: true,
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/revert-last-update') {
      const reverted = await revertLastUpdate();
      sendJson(response, 200, {
        flowId: reverted.flowId,
        ok: true,
        reverted,
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/refresh-last-run') {
      const lastRun = await refreshLatestRun();
      sendJson(response, 200, {
        lastRun,
        ok: true,
      });
      return;
    }

    sendJson(response, 404, { error: 'Route not found.' });
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(response, 400, {
        details: error.issues,
        error: 'Invalid request payload.',
      });
      return;
    }

    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const listen = (httpServer, host, port) =>
  new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

const closeHttpServer = async () => {
  if (!ownsBridgeServer) return;

  await new Promise((resolve) => {
    bridgeServer.close(() => resolve());
  });
};

const getBridgeHealthUrl = () => `http://${bridgeHost}:${bridgePort}/health`;

const probeExistingBridge = async () => {
  try {
    const response = await fetch(getBridgeHealthUrl());

    if (!response.ok) return null;

    const body = await response.json();
    return body?.ok ? body : null;
  } catch {
    return null;
  }
};

const ensureBridgeServer = async () => {
  try {
    await listen(bridgeServer, bridgeHost, bridgePort);
    ownsBridgeServer = true;
    return { mode: 'owned' };
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') {
      throw error;
    }

    const healthyBridge = await probeExistingBridge();

    if (healthyBridge) {
      ownsBridgeServer = false;
      return { mode: 'reused', health: healthyBridge };
    }

    throw new Error(
      `Bridge port ${bridgePort} is already in use, but no healthy bridge answered on ${getBridgeHealthUrl()}. Stop the stale process or choose another POWER_AUTOMATE_BRIDGE_PORT.`,
    );
  }
};

const main = async () => {
  await loadSession();
  await loadActiveTarget();
  await loadFlowCatalog();
  await loadFlowSnapshot();
  await loadLastRun();
  await loadTokenAudit();
  await loadLastUpdate();
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
