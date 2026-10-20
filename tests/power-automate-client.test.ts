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


  it('rejects direct targets that do not match the selected flow target', async () => {
    const sessionStore = await import('../server/session-store.js');
    const targetStore = await import('../server/active-target-store.js');
    const client = await import('../server/power-automate-client.js');

    await sessionStore.saveSession(validSession);
    await targetStore.saveActiveTarget(activeTarget);

    await expect(
      client.getCurrentFlow({
        target: {
          envId: 'Default-123',
          flowId: 'flow-b',
        },
      }),
    ).rejects.toMatchObject({
      code: 'TARGET_MISMATCH',
    });
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

  it('uses the most recent captured tab as session context when no work tab is selected', async () => {
    const capturedSessionsStore = await import('../server/captured-sessions-store.js');
    const client = await import('../server/power-automate-client.js');

    await capturedSessionsStore.upsertCapturedSession({
      ...validSession,
      capturedAt: '2026-04-01T00:05:00.000Z',
      flowId: 'flow-b',
      lastSeenAt: '2026-04-01T00:05:00.000Z',
      tabId: 222,
    });

    const contextPayload = client.getContextPayload();
    expect(contextPayload.context.session.connected).toBe(true);
    expect(contextPayload.context.session.flowId).toBe('flow-b');
  });

  it('connects a browser-captured flow even when the local catalog is stale', async () => {
    const capturedSessionsStore = await import('../server/captured-sessions-store.js');
    const client = await import('../server/power-automate-client.js');

    await capturedSessionsStore.upsertCapturedSession({
      ...validSession,
      capturedAt: '2026-04-01T00:05:00.000Z',
      flowId: 'flow-c',
      lastSeenAt: '2026-04-01T00:05:00.000Z',
      tabId: 333,
    });

    const connected = await client.connectFlow({ flowId: 'flow-c' });
    expect('activeTarget' in connected).toBe(true);
    if (!('activeTarget' in connected)) throw new Error('Expected connect_flow to select a target.');
    expect(connected.activeTarget?.flowId).toBe('flow-c');

    const flows = await client.listFlows();
    expect(flows.flows.map((flow) => flow.flowId)).toContain('flow-c');
  });

  it('only reports a snapshot as ready when it matches the resolved target flow', async () => {
    const sessionStore = await import('../server/session-store.js');
    const targetStore = await import('../server/active-target-store.js');
    const snapshotStore = await import('../server/flow-snapshot-store.js');
    const client = await import('../server/power-automate-client.js');

    await sessionStore.saveSession(validSession);
    await targetStore.saveActiveTarget(activeTarget);
    await snapshotStore.saveFlowSnapshot({
      capturedAt: '2026-04-01T00:10:00.000Z',
      displayName: 'Other Flow',
      envId: 'Default-123',
      flow: {
        connectionReferences: {},
        definition: { actions: {}, triggers: {} },
      },
      flowId: 'flow-b',
      source: 'page-state',
    });

    expect(client.getContextPayload().context.diagnostics.snapshotCapturedAt).toBeNull();

    await snapshotStore.saveFlowSnapshot({
      capturedAt: '2026-04-01T00:11:00.000Z',
      displayName: 'Flow A',
      envId: 'Default-123',
      flow: {
        connectionReferences: {},
        definition: { actions: {}, triggers: {} },
      },
      flowId: 'flow-a',
      source: 'page-state',
    });

    expect(client.getContextPayload().context.diagnostics.snapshotCapturedAt).toBe('2026-04-01T00:11:00.000Z');
  });
});

describe('snapshot fallback safety', () => {
  const snapshotFlow = {
    connectionReferences: {},
    definition: { actions: { FromSnapshot: { inputs: 'snapshot', type: 'Compose' } }, triggers: {} },
  };

  const proposedFlow = {
    connectionReferences: {},
    definition: updatedFlowResponse.properties.definition,
  };

  const setupTarget = async () => {
    const sessionStore = await import('../server/session-store.js');
    const targetStore = await import('../server/active-target-store.js');
    await sessionStore.saveSession(validSession);
    await targetStore.saveActiveTarget(activeTarget);
  };

  const saveSnapshot = async (capturedAt: string) => {
    const snapshotStore = await import('../server/flow-snapshot-store.js');
    await snapshotStore.saveFlowSnapshot({
      capturedAt,
      displayName: 'Flow A',
      envId: 'Default-123',
      flow: snapshotFlow,
      flowId: 'flow-a',
      source: 'xhr-response',
    });
  };

  const saveLastUpdateAt = async (capturedAt: string) => {
    const helpers = await import('../server/client-helpers.js');
    const updateStore = await import('../server/update-history-store.js');
    const flowA = {
      displayName: 'Flow A',
      envId: 'Default-123',
      flow: { connectionReferences: {}, definition: baseFlowResponse.properties.definition },
      flowId: 'flow-a',
    };
    await updateStore.saveLastUpdate({
      ...helpers.createLastUpdateRecord({ after: flowA, before: flowA }),
      capturedAt,
    });
  };

  const stubLiveReadUnavailable = () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ error: { code: 'Unauthorized', message: 'expired' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const countPatches = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH').length;

  it('marks a live read as not coming from a snapshot', async () => {
    await setupTarget();
    await saveSnapshot('2026-04-01T00:10:00.000Z');
    const client = await import('../server/power-automate-client.js');
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse(baseFlowResponse)));

    const result = await client.getCurrentFlow();

    expect(result.fromSnapshot).toBe(false);
    expect(result.snapshotCapturedAt).toBeNull();
    expect(result.flow.definition.actions).toHaveProperty('Compose');
  });

  it('returns a flagged snapshot when it is newer than the last recorded update', async () => {
    await setupTarget();
    await saveLastUpdateAt('2026-04-01T00:05:00.000Z');
    await saveSnapshot('2026-04-01T00:10:00.000Z');
    const client = await import('../server/power-automate-client.js');
    stubLiveReadUnavailable();

    const result = await client.getCurrentFlow();

    expect(result.fromSnapshot).toBe(true);
    expect(result.snapshotCapturedAt).toBe('2026-04-01T00:10:00.000Z');
    expect(result.warning).toMatch(/snapshot/i);
    expect(result.flow.definition.actions).toHaveProperty('FromSnapshot');

    const preview = await client.previewFlowUpdate({ flow: proposedFlow });
    expect(preview.fromSnapshot).toBe(true);
    expect(preview.snapshotCapturedAt).toBe('2026-04-01T00:10:00.000Z');
  });

  it('returns a flagged snapshot when no update has been recorded for the flow', async () => {
    await setupTarget();
    await saveSnapshot('2026-04-01T00:10:00.000Z');
    const client = await import('../server/power-automate-client.js');
    stubLiveReadUnavailable();

    const result = await client.getCurrentFlow();

    expect(result.fromSnapshot).toBe(true);
    expect(result.snapshotCapturedAt).toBe('2026-04-01T00:10:00.000Z');
  });

  it('refuses get_flow and preview when the only source is a snapshot older than the last update', async () => {
    await setupTarget();
    await saveSnapshot('2026-04-01T00:10:00.000Z');
    await saveLastUpdateAt('2026-04-01T00:20:00.000Z');
    const client = await import('../server/power-automate-client.js');
    stubLiveReadUnavailable();

    const staleError = {
      code: 'STALE_FLOW_SNAPSHOT',
      details: {
        lastUpdateCapturedAt: '2026-04-01T00:20:00.000Z',
        snapshotCapturedAt: '2026-04-01T00:10:00.000Z',
      },
      retryable: true,
    };

    await expect(client.getCurrentFlow()).rejects.toMatchObject(staleError);
    await expect(client.previewFlowUpdate({ flow: proposedFlow })).rejects.toMatchObject(staleError);
  });

  it('blocks apply without saving when only a stale snapshot is available', async () => {
    await setupTarget();
    await saveSnapshot('2026-04-01T00:10:00.000Z');
    await saveLastUpdateAt('2026-04-01T00:20:00.000Z');
    const updateStore = await import('../server/update-history-store.js');
    const client = await import('../server/power-automate-client.js');
    const fetchMock = stubLiveReadUnavailable();

    await expect(client.applyFlowUpdate({ flow: proposedFlow })).rejects.toMatchObject({
      code: 'LIVE_READ_UNAVAILABLE',
      message: expect.stringMatching(/reopen the flow page/i),
      retryable: true,
    });
    expect(countPatches(fetchMock)).toBe(0);
    expect(updateStore.getLastUpdate()?.capturedAt).toBe('2026-04-01T00:20:00.000Z');
  });

  it('blocks apply without saving even when a fresh snapshot exists but no live read is possible', async () => {
    await setupTarget();
    await saveSnapshot('2026-04-01T00:10:00.000Z');
    const updateStore = await import('../server/update-history-store.js');
    const client = await import('../server/power-automate-client.js');
    const fetchMock = stubLiveReadUnavailable();

    await expect(client.applyFlowUpdate({ flow: proposedFlow })).rejects.toMatchObject({
      code: 'LIVE_READ_UNAVAILABLE',
      retryable: true,
    });
    expect(countPatches(fetchMock)).toBe(0);
    expect(updateStore.getLastUpdate()).toBeNull();
  });
});

describe('expected base check', () => {
  const proposedFlow = {
    connectionReferences: {},
    definition: updatedFlowResponse.properties.definition,
  };

  const setupTarget = async () => {
    const sessionStore = await import('../server/session-store.js');
    const targetStore = await import('../server/active-target-store.js');
    await sessionStore.saveSession(validSession);
    await targetStore.saveActiveTarget(activeTarget);
  };

  const stubFlowService = (currentFlowResponse: typeof baseFlowResponse) => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) =>
      init?.method === 'PATCH' ? createJsonResponse(updatedFlowResponse) : createJsonResponse(currentFlowResponse),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const countPatches = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH').length;

  const editedElsewhereResponse = {
    properties: {
      ...baseFlowResponse.properties,
      definition: {
        actions: { Compose: { inputs: 'edited in the designer', type: 'Compose' } },
        triggers: {},
      },
    },
  };

  it('returns a base hash from get_flow and preview_flow_update', async () => {
    await setupTarget();
    const client = await import('../server/power-automate-client.js');
    stubFlowService(baseFlowResponse);

    const current = await client.getCurrentFlow();
    const preview = await client.previewFlowUpdate({ flow: proposedFlow });

    expect(current.baseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.baseHash).toBe(current.baseHash);
  });

  it('saves when expectedBaseHash matches the live flow', async () => {
    await setupTarget();
    const client = await import('../server/power-automate-client.js');
    const fetchMock = stubFlowService(baseFlowResponse);
    const { baseHash } = await client.getCurrentFlow();

    const result = await client.applyFlowUpdate({ expectedBaseHash: baseHash, flow: proposedFlow });

    expect(result.flow.displayName).toBe('Flow B');
    expect(countPatches(fetchMock)).toBe(1);
  });

  it('refuses apply and preview without saving when the live flow changed since the base was read', async () => {
    await setupTarget();
    const updateStore = await import('../server/update-history-store.js');
    const client = await import('../server/power-automate-client.js');
    stubFlowService(baseFlowResponse);
    const { baseHash } = await client.getCurrentFlow();
    const fetchMock = stubFlowService(editedElsewhereResponse);

    const mismatch = {
      code: 'FLOW_BASE_MISMATCH',
      details: { expectedBaseHash: baseHash },
      retryable: false,
    };

    await expect(client.previewFlowUpdate({ expectedBaseHash: baseHash, flow: proposedFlow })).rejects.toMatchObject(mismatch);
    await expect(client.applyFlowUpdate({ expectedBaseHash: baseHash, flow: proposedFlow })).rejects.toMatchObject(mismatch);
    expect(countPatches(fetchMock)).toBe(0);
    expect(updateStore.getLastUpdate()).toBeNull();
  });

  it('refuses apply when the flow was only renamed since the base was read', async () => {
    await setupTarget();
    const client = await import('../server/power-automate-client.js');
    stubFlowService(baseFlowResponse);
    const { baseHash } = await client.getCurrentFlow();
    const fetchMock = stubFlowService({
      properties: { ...baseFlowResponse.properties, displayName: 'Flow A (renamed in designer)' },
    });

    await expect(client.applyFlowUpdate({ expectedBaseHash: baseHash, flow: proposedFlow })).rejects.toMatchObject({
      code: 'FLOW_BASE_MISMATCH',
    });
    expect(countPatches(fetchMock)).toBe(0);
  });

  it('blocks an edit built on a snapshot once a live read shows different content', async () => {
    await setupTarget();
    const snapshotStore = await import('../server/flow-snapshot-store.js');
    const client = await import('../server/power-automate-client.js');
    await snapshotStore.saveFlowSnapshot({
      capturedAt: '2026-04-01T00:10:00.000Z',
      displayName: 'Flow A',
      envId: 'Default-123',
      flow: { connectionReferences: {}, definition: { actions: { Old: { inputs: 'old', type: 'Compose' } }, triggers: {} } },
      flowId: 'flow-a',
      source: 'xhr-response',
    });
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse({ error: { code: 'Unauthorized' } }, 401)));
    const snapshotRead = await client.getCurrentFlow();
    expect(snapshotRead.fromSnapshot).toBe(true);

    const fetchMock = stubFlowService(baseFlowResponse);

    await expect(
      client.applyFlowUpdate({ expectedBaseHash: snapshotRead.baseHash, flow: proposedFlow }),
    ).rejects.toMatchObject({ code: 'FLOW_BASE_MISMATCH' });
    expect(countPatches(fetchMock)).toBe(0);
  });

  it('rejects a blank expectedBaseHash at the schema boundary', async () => {
    const { updateFlowInputSchema } = await import('../server/schemas.js');

    expect(updateFlowInputSchema.safeParse({ expectedBaseHash: '  ', flow: proposedFlow }).success).toBe(false);
    expect(updateFlowInputSchema.safeParse({ flow: proposedFlow }).success).toBe(true);
  });
});

describe('revert_last_update base check', () => {
  const setupTarget = async () => {
    const sessionStore = await import('../server/session-store.js');
    const targetStore = await import('../server/active-target-store.js');
    await sessionStore.saveSession(validSession);
    await targetStore.saveActiveTarget(activeTarget);
  };

  // Stateful flow service: PATCH replaces the stored flow, GET returns it.
  const stubStatefulFlowService = (initial: typeof baseFlowResponse) => {
    let current: unknown = initial;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        current = JSON.parse(String(init.body));
      }
      return createJsonResponse(current);
    });
    vi.stubGlobal('fetch', fetchMock);
    return {
      fetchMock,
      setCurrent: (next: unknown) => {
        current = next;
      },
    };
  };

  const countPatches = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH').length;

  it('reverts when the flow is unchanged since the last update', async () => {
    await setupTarget();
    const client = await import('../server/power-automate-client.js');
    const { fetchMock } = stubStatefulFlowService(baseFlowResponse);

    await client.applyFlowUpdate({
      displayName: 'Flow B',
      flow: { connectionReferences: {}, definition: updatedFlowResponse.properties.definition },
    });
    const reverted = await client.revertLastUpdate();

    expect(countPatches(fetchMock)).toBe(2);
    expect(reverted.flow.displayName).toBe('Flow A');
    expect(reverted.flow.flow.definition.actions).toHaveProperty('Compose');
  });

  it('refuses to revert without saving when the flow changed after the last update', async () => {
    await setupTarget();
    const updateStore = await import('../server/update-history-store.js');
    const client = await import('../server/power-automate-client.js');
    const { fetchMock, setCurrent } = stubStatefulFlowService(baseFlowResponse);

    await client.applyFlowUpdate({
      displayName: 'Flow B',
      flow: { connectionReferences: {}, definition: updatedFlowResponse.properties.definition },
    });
    const savedUpdate = updateStore.getLastUpdate();
    setCurrent({
      properties: {
        ...updatedFlowResponse.properties,
        definition: { actions: { EditedInDesigner: { inputs: 'later', type: 'Compose' } }, triggers: {} },
      },
    });

    await expect(client.revertLastUpdate()).rejects.toMatchObject({
      code: 'FLOW_BASE_MISMATCH',
      message: expect.stringMatching(/revert/i),
    });
    expect(countPatches(fetchMock)).toBe(1);
    expect(updateStore.getLastUpdate()).toEqual(savedUpdate);
  });
});
