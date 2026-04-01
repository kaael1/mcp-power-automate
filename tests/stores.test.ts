import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const validSession = {
  apiToken: 'Bearer token',
  apiUrl: 'https://example.api.powerplatform.com/',
  capturedAt: '2026-04-01T00:00:00.000Z',
  envId: 'Default-123',
  flowId: '123e4567-e89b-12d3-a456-426614174000',
};

let tempDir = '';

beforeEach(async () => {
  vi.resetModules();
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-pa-'));
  process.env.POWER_AUTOMATE_DATA_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.POWER_AUTOMATE_DATA_DIR;
  await rm(tempDir, { force: true, recursive: true });
});

describe('stores', () => {
  it('persists sessions in the configured data directory', async () => {
    const sessionStore = await import('../server/session-store.js');

    await sessionStore.saveSession(validSession);

    const savedFile = await readFile(path.join(tempDir, 'session.json'), 'utf8');
    expect(JSON.parse(savedFile)).toMatchObject(validSession);
    expect(sessionStore.getSessionFilePath()).toBe(path.join(tempDir, 'session.json'));
  });

  it('loads legacy single-record snapshot files into the new keyed shape', async () => {
    await writeFile(
      path.join(tempDir, 'flow-snapshot.json'),
      JSON.stringify(
        {
          capturedAt: '2026-04-01T00:00:00.000Z',
          envId: 'env-1',
          flow: {
            connectionReferences: {},
            definition: {
              actions: {},
              triggers: {},
            },
          },
          flowId: 'flow-1',
          source: 'test',
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshotStore = await import('../server/flow-snapshot-store.js');
    const loaded = await snapshotStore.loadFlowSnapshot();

    expect(loaded).toMatchObject({
      activeKey: 'env-1:flow-1',
    });
    expect(snapshotStore.getFlowSnapshotForFlow({ envId: 'env-1', flowId: 'flow-1' })).toMatchObject({
      source: 'test',
    });
  });

  it('loads legacy last-run files and rewrites them as keyed records on save', async () => {
    await writeFile(
      path.join(tempDir, 'last-run.json'),
      JSON.stringify(
        {
          capturedAt: '2026-04-01T00:00:00.000Z',
          envId: 'env-1',
          flowId: 'flow-1',
          run: {
            flowId: 'flow-1',
            runId: 'run-1',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const runStore = await import('../server/last-run-store.js');
    await runStore.loadLastRun();
    await runStore.saveLastRun({
      capturedAt: '2026-04-02T00:00:00.000Z',
      envId: 'env-1',
      flowId: 'flow-1',
      run: {
        flowId: 'flow-1',
        runId: 'run-2',
      },
    });

    const persisted = JSON.parse(await readFile(path.join(tempDir, 'last-run.json'), 'utf8'));

    expect(persisted.activeKey).toBe('env-1:flow-1');
    expect(Object.keys(persisted.records)).toContain('env-1:flow-1');
    expect(persisted.records['env-1:flow-1'].run.runId).toBe('run-2');
  });
});
