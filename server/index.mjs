import http from 'node:http';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ZodError } from 'zod';

import { bridgeHost, bridgePort, flowSnapshotSchema, sessionSchema, tokenAuditSchema } from './schemas.mjs';
import { loadFlowSnapshot, saveFlowSnapshot, getFlowSnapshot } from './flow-snapshot-store.mjs';
import { getLastRunSummary, getLastUpdateSummary, refreshLatestRun, revertLastUpdate } from './power-automate-client.mjs';
import { getLastRun, loadLastRun } from './last-run-store.mjs';
import { loadSession, saveSession, getSession } from './session-store.mjs';
import { loadTokenAudit, saveTokenAudit, getTokenAudit } from './token-audit-store.mjs';
import { loadLastUpdate, getLastUpdate } from './update-history-store.mjs';
import { createMcpApp } from './tools.mjs';

const mcpServer = createMcpApp();

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

  return {
    capturedAt: session?.capturedAt || null,
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
        error: 'Invalid session payload.',
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

const closeHttpServer = async () =>
  new Promise((resolve) => {
    bridgeServer.close(() => resolve());
  });

const main = async () => {
  await loadSession();
  await loadFlowSnapshot();
  await loadLastRun();
  await loadTokenAudit();
  await loadLastUpdate();
  await listen(bridgeServer, bridgeHost, bridgePort);

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
