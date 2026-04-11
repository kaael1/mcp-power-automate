import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const validSession = {
  apiToken: 'Bearer modern-token',
  apiUrl: 'https://example.api.powerplatform.com/',
  capturedAt: '2026-04-01T00:00:00.000Z',
  envId: 'Default-123',
  flowId: 'flow-a',
  portalUrl: 'https://make.powerautomate.com/environments/Default-123/flows/flow-a/details',
};

const activeTarget = {
  displayName: 'Flow A',
  envId: 'Default-123',
  flowId: 'flow-a',
  selectedAt: '2026-04-01T00:01:00.000Z',
  selectionSource: 'manual' as const,
};

const baseFlowResponse = {
  properties: {
    connectionReferences: {},
    definition: {
      actions: {
        Compose: {
          inputs: 'hello',
          type: 'Compose',
        },
      },
      triggers: {},
    },
    displayName: 'Flow A',
  },
};

const updatedFlowResponse = {
  properties: {
    connectionReferences: {},
    definition: {
      actions: {
        Compose2: {
          inputs: 'updated',
          type: 'Compose',
        },
      },
      triggers: {},
    },
    displayName: 'Flow B',
  },
};

let tempDir = '';

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-pa-client-'));
  process.env.POWER_AUTOMATE_DATA_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.POWER_AUTOMATE_DATA_DIR;
  await rm(tempDir, { force: true, recursive: true });
});

const createJsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status,
  });

describe('power automate client', () => {
  it('previews a flow update without mutating persisted update history', async () => {
    const sessionStore = await import('../server/session-store.js');
    const targetStore = await import('../server/active-target-store.js');
    const updateStore = await import('../server/update-history-store.js');
    const client = await import('../server/power-automate-client.js');

    await sessionStore.saveSession(validSession);
    await targetStore.saveActiveTarget(activeTarget);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createJsonResponse(baseFlowResponse)),
    );

    const result = await client.previewFlowUpdate({
      displayName: 'Flow B',
      flow: {
        connectionReferences: {},
        definition: updatedFlowResponse.properties.definition,
      },
    });

    expect(result.lastUpdate.summary.changedDisplayName).toBe(true);
    expect(result.lastUpdate.summary.changedFlowBody).toBe(true);
    expect(updateStore.getLastUpdate()).toBeNull();
  });

  it('applies a flow update and persists the resulting review diff', async () => {
    const sessionStore = await import('../server/session-store.js');
    const targetStore = await import('../server/active-target-store.js');
    const updateStore = await import('../server/update-history-store.js');
    const client = await import('../server/power-automate-client.js');

    await sessionStore.saveSession(validSession);
    await targetStore.saveActiveTarget(activeTarget);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) =>
        init?.method === 'PATCH' ? createJsonResponse(updatedFlowResponse) : createJsonResponse(baseFlowResponse),
      ),
    );

    const result = await client.applyFlowUpdate({
      displayName: 'Flow B',
      flow: {
        connectionReferences: {},
        definition: updatedFlowResponse.properties.definition,
      },
    });

    expect(result.flow.displayName).toBe('Flow B');
    expect(result.lastUpdate.summary.changedDisplayName).toBe(true);
    expect(updateStore.getLastUpdate()?.flowId).toBe('flow-a');
  });

  it('reports capability diagnostics when store health is corrupted and no session is available', async () => {
    const storeUtils = await import('../server/store-utils.js');
    const client = await import('../server/power-automate-client.js');

    vi.spyOn(storeUtils, 'getStoreDiagnostics').mockReturnValue([
      {
        filePath: path.join(tempDir, 'session.json'),
        loadedAt: '2026-04-01T00:00:00.000Z',
        message: 'Unexpected token',
        name: 'session',
        state: 'corrupted',
        version: null,
      },
    ]);

    const contextPayload = client.getContextPayload();

    expect(contextPayload.context.capabilities.canReadFlows.available).toBe(false);
    expect(contextPayload.context.capabilities.canReadFlows.reasonCode).toBe('STORE_CORRUPTED');
    expect(contextPayload.context.diagnostics.storeHealth.ok).toBe(false);
  });

  it('lists captured tabs and lets the selected work tab drive the effective context', async () => {
    const sessionStore = await import('../server/session-store.js');
    const capturedSessionsStore = await import('../server/captured-sessions-store.js');
    const client = await import('../server/power-automate-client.js');

    await sessionStore.saveSession({
      ...validSession,
      tabId: 111,
    });
    await capturedSessionsStore.upsertCapturedSession({
      ...validSession,
      capturedAt: '2026-04-01T00:05:00.000Z',
      envId: 'Default-999',
      flowId: 'flow-b',
      lastSeenAt: '2026-04-01T00:05:00.000Z',
      tabId: 222,
    });

    const capturedTabs = client.listCapturedTabs();
    expect(capturedTabs.map((session) => session.tabId)).toEqual([222, 111]);
    expect(client.getContextPayload().context.session.flowId).toBe('flow-a');

    await client.selectWorkTab({ tabId: 222 });

    const contextPayload = client.getContextPayload();
    expect(contextPayload.context.selection.selectedWorkSession?.tabId).toBe(222);
    expect(contextPayload.context.session.envId).toBe('Default-999');
    expect(contextPayload.context.session.flowId).toBe('flow-b');
  });
});
