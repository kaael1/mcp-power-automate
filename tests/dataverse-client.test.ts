import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createJsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status,
  });

const baseSession = {
  apiToken: 'Bearer modern-token',
  apiUrl: 'https://example.api.powerplatform.com/',
  capturedAt: '2026-04-01T00:00:00.000Z',
  envId: 'Default-123',
  flowId: 'flow-a',
};

const cachedOrg = {
  envId: 'Default-123',
  instanceApiUrl: 'https://org.api.crm.dynamics.com',
  instanceUrl: 'https://org.crm.dynamics.com',
  resolvedAt: '2026-04-01T00:00:00.000Z',
  uniqueName: 'org',
};

let tempDir = '';

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-pa-dv-'));
  process.env.POWER_AUTOMATE_DATA_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.POWER_AUTOMATE_DATA_DIR;
  await rm(tempDir, { force: true, recursive: true });
});

describe('dataverse client', () => {
  it('reports solution capability from accumulated BAP and Dataverse tokens', async () => {
    const sessionStore = await import('../server/session-store.js');
    const tokenAuditStore = await import('../server/token-audit-store.js');
    const orgStore = await import('../server/dataverse-org-store.js');
    const dataverseClient = await import('../server/dataverse-client.js');
    const exp = Math.floor(Date.now() / 1000) + 3600;

    await sessionStore.saveSession(baseSession);
    expect(dataverseClient.hasManageSolutionsTokens('Default-123')).toMatchObject({
      available: false,
      reasonCode: 'BAP_TOKEN_MISSING',
    });

    await tokenAuditStore.saveTokenAudit({
      candidates: [
        {
          aud: 'https://api.bap.microsoft.com',
          exp,
          source: 'test',
          token: 'bap-token',
        },
      ],
      capturedAt: '2026-04-01T00:00:00.000Z',
      source: 'test',
    });

    expect(dataverseClient.hasManageSolutionsTokens('Default-123')).toMatchObject({
      available: true,
      reasonCode: null,
    });

    await orgStore.saveDataverseOrgRecord(cachedOrg);
    expect(dataverseClient.hasManageSolutionsTokens('Default-123')).toMatchObject({
      available: false,
      reasonCode: 'DATAVERSE_TOKEN_MISSING',
    });

    await tokenAuditStore.mergeTokenAudit({
      candidates: [
        {
          aud: 'https://org.crm.dynamics.com',
          exp,
          source: 'test',
          token: 'dataverse-token',
        },
      ],
      capturedAt: '2026-04-01T00:01:00.000Z',
      source: 'test',
    });

    expect(dataverseClient.hasManageSolutionsTokens('Default-123')).toMatchObject({
      available: true,
      reasonCode: null,
    });
  });

  it('lists solutions through Dataverse with read-only filters', async () => {
    const tokenAuditStore = await import('../server/token-audit-store.js');
    const orgStore = await import('../server/dataverse-org-store.js');
    const solutions = await import('../server/dataverse-solutions.js');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        value: [
          {
            friendlyname: 'Core',
            ismanaged: false,
            isvisible: true,
            publisherid: {
              friendlyname: 'Publisher',
              publisherid: 'publisher-id',
              uniquename: 'pub',
            },
            solutionid: 'solution-id',
            uniquename: 'Core',
            version: '1.0.0.0',
          },
        ],
      }),
    );

    await orgStore.saveDataverseOrgRecord(cachedOrg);
    await tokenAuditStore.saveTokenAudit({
      candidates: [
        {
          aud: 'https://org.crm.dynamics.com',
          exp,
          source: 'test',
          token: 'dataverse-token',
        },
      ],
      capturedAt: '2026-04-01T00:00:00.000Z',
      source: 'test',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await solutions.listSolutions({ envId: 'Default-123' });
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(calledUrl);

    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dataverse-token');
    expect(url.pathname).toBe('/api/data/v9.2/solutions');
    expect(url.searchParams.get('$filter')).toContain('isvisible eq true');
    expect(url.searchParams.get('$filter')).toContain('ismanaged eq false');
    expect(result.solutions[0]).toMatchObject({
      publisher: {
        uniqueName: 'pub',
      },
      uniqueName: 'Core',
    });
  });
});
