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

const createNoContentResponse = (headers: Record<string, string> = {}) =>
  new Response(null, {
    headers,
    status: 204,
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

  it('reports solution capability from cached Dataverse org without requiring BAP again', async () => {
    const tokenAuditStore = await import('../server/token-audit-store.js');
    const orgStore = await import('../server/dataverse-org-store.js');
    const dataverseClient = await import('../server/dataverse-client.js');
    const exp = Math.floor(Date.now() / 1000) + 3600;

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

  it('follows Dataverse nextLink when listing solutions', async () => {
    const tokenAuditStore = await import('../server/token-audit-store.js');
    const orgStore = await import('../server/dataverse-org-store.js');
    const solutions = await import('../server/dataverse-solutions.js');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const nextLink =
      'https://org.api.crm.dynamics.com/api/data/v9.2/solutions?$skiptoken=%3Ccookie%20page%3D%222%22%20%2F%3E';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          '@odata.nextLink': nextLink,
          value: [
            {
              friendlyname: 'Core',
              ismanaged: false,
              isvisible: true,
              solutionid: 'solution-id-1',
              uniquename: 'Core',
              version: '1.0.0.0',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          value: [
            {
              friendlyname: 'Ops',
              ismanaged: false,
              isvisible: true,
              solutionid: 'solution-id-2',
              uniquename: 'Ops',
              version: '2.0.0.0',
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
    const [secondUrl] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondUrl.toString()).toBe(nextLink);
    expect(result.solutions.map((solution) => solution.uniqueName)).toEqual(['Core', 'Ops']);
  });

  it('adds an existing flow to an unmanaged solution through AddSolutionComponent', async () => {
    const tokenAuditStore = await import('../server/token-audit-store.js');
    const orgStore = await import('../server/dataverse-org-store.js');
    const solutions = await import('../server/dataverse-solutions.js');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          value: [
            {
              friendlyname: 'Core',
              ismanaged: false,
              solutionid: 'solution-id',
              uniquename: 'Core',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ SolutionComponentId: 'component-id' }));

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

    const result = await solutions.addFlowToSolution({
      envId: 'Default-123',
      flowId: 'flow-id',
      solutionUniqueName: 'Core',
    });
    const [actionUrl, actionInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const actionBody = JSON.parse(actionInit.body as string) as Record<string, unknown>;

    expect(new URL(actionUrl).pathname).toBe('/api/data/v9.2/AddSolutionComponent');
    expect(actionInit.method).toBe('POST');
    expect((actionInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(actionBody).toEqual({
      AddRequiredComponents: false,
      ComponentId: 'flow-id',
      ComponentType: 29,
      SolutionUniqueName: 'Core',
    });
    expect(result).toMatchObject({
      componentTypeName: 'workflow',
      flowId: 'flow-id',
      solution: {
        uniqueName: 'Core',
      },
    });
  });

  it('rejects adding flows to managed solutions before calling AddSolutionComponent', async () => {
    const tokenAuditStore = await import('../server/token-audit-store.js');
    const orgStore = await import('../server/dataverse-org-store.js');
    const solutions = await import('../server/dataverse-solutions.js');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        value: [
          {
            friendlyname: 'Managed',
            ismanaged: true,
            solutionid: 'solution-id',
            uniquename: 'Managed',
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

    await expect(
      solutions.addFlowToSolution({
        envId: 'Default-123',
        flowId: 'flow-id',
        solutionUniqueName: 'Managed',
      }),
    ).rejects.toThrow(/managed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a Dataverse cloud flow and adds its workflow id to the solution', async () => {
    const tokenAuditStore = await import('../server/token-audit-store.js');
    const orgStore = await import('../server/dataverse-org-store.js');
    const solutions = await import('../server/dataverse-solutions.js');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          value: [
            {
              friendlyname: 'Core',
              ismanaged: false,
              solutionid: 'solution-id',
              uniquename: 'Core',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createNoContentResponse({
          'OData-EntityId': 'https://org.api.crm.dynamics.com/api/data/v9.2/workflows(workflow-id)',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          value: [
            {
              friendlyname: 'Core',
              ismanaged: false,
              solutionid: 'solution-id',
              uniquename: 'Core',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ id: 'component-id' }));

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

    const result = await solutions.createFlowInSolution({
      displayName: 'New Flow',
      envId: 'Default-123',
      solutionUniqueName: 'Core',
      triggerType: 'request',
    });
    const [, createInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const createBody = JSON.parse(createInit.body as string) as Record<string, unknown>;
    const [, addInit] = fetchMock.mock.calls[3] as unknown as [string, RequestInit];
    const addBody = JSON.parse(addInit.body as string) as Record<string, unknown>;

    expect(createBody).toMatchObject({
      category: 5,
      name: 'New Flow',
      primaryentity: 'none',
      type: 1,
    });
    expect(JSON.parse(createBody.clientdata as string)).toMatchObject({
      properties: {
        connectionReferences: {},
      },
      schemaVersion: '1.0.0.0',
    });
    expect(addBody).toMatchObject({
      AddRequiredComponents: false,
      ComponentId: 'workflow-id',
      ComponentType: 29,
      SolutionUniqueName: 'Core',
    });
    expect(result).toMatchObject({
      displayName: 'New Flow',
      flowId: 'workflow-id',
      solutionComponent: {
        componentTypeName: 'workflow',
      },
    });
  });
});
