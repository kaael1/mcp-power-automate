import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const baseSession = {
  apiToken: 'Bearer modern-token',
  apiUrl: 'https://example.api.powerplatform.com/',
  capturedAt: '2026-04-01T00:00:00.000Z',
  envId: 'Default-123',
  flowId: 'flow-a',
};

const tokenAuditFixture = {
  capturedAt: '2026-04-01T00:00:00.000Z',
  source: 'test',
  candidates: [
    {
      aud: 'https://api.bap.microsoft.com/',
      source: 'sessionStorage',
      token: 'bap-jwt',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    {
      aud: 'https://orgabc.crm.dynamics.com/',
      source: 'sessionStorage',
      token: 'dataverse-jwt',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  ],
};

const cachedDataverseRecord = {
  envId: 'Default-123',
  instanceApiUrl: 'https://orgabc.api.crm.dynamics.com',
  instanceUrl: 'https://orgabc.crm.dynamics.com',
  resolvedAt: '2026-04-01T00:00:00.000Z',
  uniqueName: 'orgabc',
};

const createJsonResponse = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', ...headers },
    status,
  });

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

const seedSessionsAndTokens = async () => {
  const sessionStore = await import('../server/session-store.js');
  const tokenStore = await import('../server/token-audit-store.js');
  const orgStore = await import('../server/dataverse-org-store.js');
  await sessionStore.saveSession(baseSession);
  await tokenStore.saveTokenAudit(tokenAuditFixture);
  await orgStore.saveDataverseOrgRecord(cachedDataverseRecord);
};

describe('dataverse-client token selection', () => {
  it('picks the BAP token from token-audit candidates', async () => {
    const tokenStore = await import('../server/token-audit-store.js');
    await tokenStore.saveTokenAudit(tokenAuditFixture);
    const dv = await import('../server/dataverse-client.js');
    const candidate = dv.pickBapToken();
    expect(candidate?.token).toBe('bap-jwt');
  });

  it('picks the Dataverse token by host even when instanceUrl has the api. prefix stripped form', async () => {
    const tokenStore = await import('../server/token-audit-store.js');
    await tokenStore.saveTokenAudit(tokenAuditFixture);
    const dv = await import('../server/dataverse-client.js');
    expect(dv.pickDataverseToken('https://orgabc.crm.dynamics.com')?.token).toBe('dataverse-jwt');
    expect(dv.pickDataverseToken('https://orgabc.api.crm.dynamics.com')?.token).toBe('dataverse-jwt');
  });

  it('returns null when no Dataverse-audience token matches the org host', async () => {
    const tokenStore = await import('../server/token-audit-store.js');
    await tokenStore.saveTokenAudit({
      ...tokenAuditFixture,
      candidates: [tokenAuditFixture.candidates[0]],
    });
    const dv = await import('../server/dataverse-client.js');
    expect(dv.pickDataverseToken('https://orgabc.crm.dynamics.com')).toBeNull();
  });
});

describe('requestDataverse', () => {
  it('injects OData headers and Bearer token on writes, plus MSCRM.SolutionUniqueName when supplied', async () => {
    await seedSessionsAndTokens();
    const dv = await import('../server/dataverse-client.js');

    const fetchMock = vi.fn(async () => createJsonResponse({ id: 'created' }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const result = await dv.requestDataverse({
      instance: cachedDataverseRecord,
      method: 'POST',
      path: 'environmentvariabledefinitions',
      headers: { 'MSCRM.SolutionUniqueName': 'TestSolution' },
      body: { schemaname: 'pub_Foo', type: 100000000 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(
      'https://orgabc.api.crm.dynamics.com/api/data/v9.2/environmentvariabledefinitions',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer dataverse-jwt');
    expect(headers['OData-MaxVersion']).toBe('4.0');
    expect(headers['OData-Version']).toBe('4.0');
    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(headers.Prefer).toBe('return=representation');
    expect(headers['MSCRM.SolutionUniqueName']).toBe('TestSolution');
    expect(JSON.parse(init.body as string)).toEqual({ schemaname: 'pub_Foo', type: 100000000 });
    expect(result.status).toBe(201);
  });

  it('appends $filter / $select / $top to the URL', async () => {
    await seedSessionsAndTokens();
    const dv = await import('../server/dataverse-client.js');
    const fetchMock = vi.fn(async () => createJsonResponse({ value: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await dv.requestDataverse({
      instance: cachedDataverseRecord,
      method: 'GET',
      path: 'solutions',
      query: { $filter: "uniquename eq 'X'", $select: 'solutionid', $top: 1 },
    });

    const [calledUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(calledUrl);
    expect(url.pathname).toBe('/api/data/v9.2/solutions');
    expect(url.searchParams.get('$filter')).toBe("uniquename eq 'X'");
    expect(url.searchParams.get('$select')).toBe('solutionid');
    expect(url.searchParams.get('$top')).toBe('1');
  });

  it('throws SESSION_EXPIRED on 401', async () => {
    await seedSessionsAndTokens();
    const dv = await import('../server/dataverse-client.js');
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse({ error: { message: 'expired' } }, 401)));
    await expect(
      dv.requestDataverse({ instance: cachedDataverseRecord, method: 'GET', path: 'solutions' }),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});

describe('dataverse-solutions tools', () => {
  const solutionRow = {
    solutionid: 'sol-guid',
    uniquename: 'TestSolution',
    friendlyname: 'Test Solution',
    version: '1.0.0.0',
    ismanaged: false,
    isvisible: true,
  };

  it('list_solutions filters out managed by default and returns summarized publishers', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');
    const fetchMock = vi.fn(async () =>
      createJsonResponse({
        value: [
          {
            ...solutionRow,
            publisherid: { publisherid: 'pub-guid', uniquename: 'adres', friendlyname: 'Adres' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await dvs.listSolutions({});

    const [calledUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const filter = new URL(calledUrl).searchParams.get('$filter') ?? '';
    expect(filter).toContain('isvisible eq true');
    expect(filter).toContain('ismanaged eq false');
    expect(result.solutions[0]).toMatchObject({
      uniqueName: 'TestSolution',
      publisher: { uniqueName: 'adres', friendlyName: 'Adres' },
    });
  });

  it('create_environment_variable sends MSCRM.SolutionUniqueName header and creates a value row when initialValue is supplied', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/environmentvariabledefinitions') && method === 'POST') {
        return createJsonResponse(
          {
            environmentvariabledefinitionid: 'def-guid',
            schemaname: 'adres_Foo',
            displayname: 'Foo',
            type: 100000000,
          },
          201,
        );
      }
      if (path.endsWith('/environmentvariablevalues') && method === 'POST') {
        return createJsonResponse(
          { environmentvariablevalueid: 'val-guid', value: 'hello' },
          201,
        );
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dvs.createEnvironmentVariable({
      solutionUniqueName: 'TestSolution',
      schemaName: 'adres_Foo',
      displayName: 'Foo',
      type: 'string',
      initialValue: 'hello',
    });

    const defCall = fetchMock.mock.calls.find((call) => {
      const u = new URL(String(call[0]));
      return u.pathname.endsWith('/environmentvariabledefinitions') && (call[1] as RequestInit | undefined)?.method === 'POST';
    });
    expect(defCall).toBeDefined();
    expect((defCall![1] as RequestInit).headers).toMatchObject({
      'MSCRM.SolutionUniqueName': 'TestSolution',
    });
    const valCall = fetchMock.mock.calls.find((call) => {
      const u = new URL(String(call[0]));
      return u.pathname.endsWith('/environmentvariablevalues') && (call[1] as RequestInit | undefined)?.method === 'POST';
    });
    expect(valCall).toBeDefined();
    expect(JSON.parse((valCall![1] as RequestInit).body as string)).toMatchObject({
      schemaname: 'adres_Foo_value',
      value: 'hello',
      'EnvironmentVariableDefinitionId@odata.bind': '/environmentvariabledefinitions(def-guid)',
    });
    expect(result.definition.currentValue).toBe('hello');
  });

  it('set_env_var_value PATCHes the existing value row when one already exists', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const fetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method;
      if (url.includes('/environmentvariabledefinitions') && method === 'GET') {
        return createJsonResponse({
          value: [
            {
              environmentvariabledefinitionid: 'def-guid',
              schemaname: 'adres_Foo',
              type: 100000000,
              environmentvariabledefinition_environmentvariablevalue: [
                { environmentvariablevalueid: 'val-guid', value: 'old' },
              ],
            },
          ],
        });
      }
      if (url.includes('/environmentvariablevalues(val-guid)') && method === 'PATCH') {
        return createJsonResponse({ environmentvariablevalueid: 'val-guid', value: 'new' });
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dvs.setEnvVarValue({ schemaName: 'adres_Foo', value: 'new' });
    expect(result.action).toBe('updated');
    expect(result.valueId).toBe('val-guid');
    expect(result.value).toBe('new');
    const patchCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({ value: 'new' });
  });

  it('set_env_var_value creates a value row when none exists and solutionUniqueName is provided', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/environmentvariabledefinitions') && method === 'GET') {
        return createJsonResponse({
          value: [
            {
              environmentvariabledefinitionid: 'def-guid',
              schemaname: 'adres_Foo',
              type: 100000000,
              environmentvariabledefinition_environmentvariablevalue: [],
            },
          ],
        });
      }
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/environmentvariablevalues') && method === 'POST') {
        return createJsonResponse({ environmentvariablevalueid: 'val-guid', value: 'fresh' }, 201);
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dvs.setEnvVarValue({
      schemaName: 'adres_Foo',
      value: 'fresh',
      solutionUniqueName: 'TestSolution',
    });

    expect(result.action).toBe('created');
    expect(result.valueId).toBe('val-guid');
    const postCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).endsWith('/environmentvariablevalues'),
    );
    expect((postCall![1] as RequestInit).headers).toMatchObject({
      'MSCRM.SolutionUniqueName': 'TestSolution',
    });
  });

  it('add_existing_to_solution maps "workflow" to component type 29 in the AddSolutionComponent body', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');
    const fetchMock = vi.fn(async () => createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await dvs.addExistingToSolution({
      solutionUniqueName: 'TestSolution',
      componentId: '0ea141eb-1e63-7aaa-2aec-32e6c6987016',
      componentType: 'workflow',
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toContain('/AddSolutionComponent');
    expect(JSON.parse(init.body as string)).toMatchObject({
      ComponentId: '0ea141eb-1e63-7aaa-2aec-32e6c6987016',
      ComponentType: 29,
      SolutionUniqueName: 'TestSolution',
      AddRequiredComponents: true,
      DoNotIncludeSubcomponents: false,
    });
  });

  it('create_environment_variable rolls back the orphaned definition when the value-row POST fails', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const deleteCalls: string[] = [];
    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/environmentvariabledefinitions') && method === 'POST') {
        return createJsonResponse({ environmentvariabledefinitionid: 'def-guid', schemaname: 'adres_X', type: 100000000 }, 201);
      }
      if (path.endsWith('/environmentvariablevalues') && method === 'POST') {
        return createJsonResponse({ error: { message: 'simulated failure' } }, 500);
      }
      if (path.includes('/environmentvariabledefinitions(def-guid)') && method === 'DELETE') {
        deleteCalls.push(path);
        return createJsonResponse({}, 200);
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      dvs.createEnvironmentVariable({
        solutionUniqueName: 'TestSolution',
        schemaName: 'adres_X',
        displayName: 'X',
        type: 'string',
        initialValue: 'will-fail',
      }),
    ).rejects.toMatchObject({
      code: 'ROLLED_BACK',
      retryable: true,
      message: expect.stringContaining('adres_X'),
    });
    // Rollback DELETE on the definition was attempted
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain('/environmentvariabledefinitions(def-guid)');
  });

  it('create_environment_variable surfaces PARTIAL_FAILURE with orphan id when rollback also fails', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/environmentvariabledefinitions') && method === 'POST') {
        return createJsonResponse({ environmentvariabledefinitionid: 'orphan-guid', schemaname: 'adres_X', type: 100000000 }, 201);
      }
      if (path.endsWith('/environmentvariablevalues') && method === 'POST') {
        return createJsonResponse({ error: { message: 'simulated value-row failure' } }, 500);
      }
      if (path.includes('/environmentvariabledefinitions(orphan-guid)') && method === 'DELETE') {
        return createJsonResponse({ error: { message: 'simulated rollback failure' } }, 500);
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      dvs.createEnvironmentVariable({
        solutionUniqueName: 'TestSolution',
        schemaName: 'adres_X',
        displayName: 'X',
        type: 'string',
        initialValue: 'will-fail',
      }),
    ).rejects.toMatchObject({
      code: 'PARTIAL_FAILURE',
      retryable: false,
      message: expect.stringContaining('orphan-guid'),
      details: {
        orphanDefinitionId: 'orphan-guid',
        schemaName: 'adres_X',
        solutionUniqueName: 'TestSolution',
      },
    });
  });
});

describe('Phase 4 lifecycle tools', () => {
  it('delete_solution refuses non-empty solutions when force is omitted', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/solutioncomponents') && method === 'GET') {
        return createJsonResponse({ value: [{ objectid: 'comp-1' }] });
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(dvs.deleteSolution({ uniqueName: 'TestSolution' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    // No DELETE was issued
    expect(fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBeUndefined();
  });

  it('delete_solution skips the safety check when force is true', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const componentsCalls: number[] = [];
    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/solutioncomponents') && method === 'GET') {
        componentsCalls.push(1);
        return createJsonResponse({ value: [{ objectid: 'comp-1' }] });
      }
      if (path.includes('/solutions(sol-guid)') && method === 'DELETE') {
        return createJsonResponse({}, 200);
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dvs.deleteSolution({ uniqueName: 'TestSolution', force: true });
    expect(result.ok).toBe(true);
    expect(result.solutionId).toBe('sol-guid');
    // Safety GET on solutioncomponents should have been skipped
    expect(componentsCalls).toHaveLength(0);
  });

  it('delete_environment_variable deletes value rows before the definition', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const orderedDeletes: string[] = [];
    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/environmentvariabledefinitions') && method === 'GET') {
        return createJsonResponse({
          value: [
            {
              environmentvariabledefinitionid: 'def-guid',
              schemaname: 'adres_X',
              type: 100000000,
              environmentvariabledefinition_environmentvariablevalue: [
                { environmentvariablevalueid: 'val-1', value: 'a' },
                { environmentvariablevalueid: 'val-2', value: 'b' },
              ],
            },
          ],
        });
      }
      if (method === 'DELETE') {
        orderedDeletes.push(path);
        return createJsonResponse({}, 200);
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dvs.deleteEnvironmentVariable({ schemaName: 'adres_X' });
    expect(result.deletedValueRows).toBe(2);
    expect(result.ok).toBe(true);
    // Two value-row deletes BEFORE the definition delete
    expect(orderedDeletes).toHaveLength(3);
    expect(orderedDeletes[0]).toContain('environmentvariablevalues(val-1)');
    expect(orderedDeletes[1]).toContain('environmentvariablevalues(val-2)');
    expect(orderedDeletes[2]).toContain('environmentvariabledefinitions(def-guid)');
  });

  it('publish_customizations posts to PublishAllXml by default', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');
    const fetchMock = vi.fn(async () => createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await dvs.publishCustomizations({});
    expect(result.scope).toBe('all');
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toContain('/PublishAllXml');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('publish_customizations posts to PublishXml with ParameterXml when scoped', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');
    const fetchMock = vi.fn(async () => createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const xml = '<importexportxml><entities><entity>account</entity></entities></importexportxml>';
    const result = await dvs.publishCustomizations({ parameterXml: xml });
    expect(result.scope).toBe('scoped');
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toContain('/PublishXml');
    expect(JSON.parse(init.body as string)).toEqual({ ParameterXml: xml });
  });

  it('remove_from_solution looks up the solutioncomponents row and posts an @odata.bind reference', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');

    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/solutioncomponents') && method === 'GET') {
        // Verify the lookup filter shape
        const filter = url.searchParams.get('$filter') ?? '';
        expect(filter).toContain('_solutionid_value eq sol-guid');
        expect(filter).toContain('objectid eq 0ea141eb-1e63-7aaa-2aec-32e6c6987016');
        expect(filter).toContain('componenttype eq 380');
        return createJsonResponse({ value: [{ solutioncomponentid: 'scc-guid' }] });
      }
      if (path.endsWith('/RemoveSolutionComponent') && method === 'POST') {
        return createJsonResponse({});
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await dvs.removeFromSolution({
      solutionUniqueName: 'TestSolution',
      componentId: '0ea141eb-1e63-7aaa-2aec-32e6c6987016',
      componentType: 'environmentVariableDefinition',
    });

    const actionCall = fetchMock.mock.calls.find((call) => {
      const u = new URL(String(call[0]));
      return u.pathname.endsWith('/RemoveSolutionComponent') && (call[1] as RequestInit | undefined)?.method === 'POST';
    });
    expect(actionCall).toBeDefined();
    expect(JSON.parse((actionCall![1] as RequestInit).body as string)).toEqual({
      'SolutionComponent@odata.bind': '/solutioncomponents(scc-guid)',
      ComponentType: 380,
      SolutionUniqueName: 'TestSolution',
    });
  });

  it('remove_from_solution refuses when the component is not in the named solution', async () => {
    await seedSessionsAndTokens();
    const dvs = await import('../server/dataverse-solutions.js');
    const fetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = (init as RequestInit | undefined)?.method;
      const path = url.pathname;
      if (path.endsWith('/solutions') && method === 'GET') {
        return createJsonResponse({ value: [{ solutionid: 'sol-guid' }] });
      }
      if (path.endsWith('/solutioncomponents') && method === 'GET') {
        return createJsonResponse({ value: [] });
      }
      throw new Error(`Unexpected fetch ${method} ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      dvs.removeFromSolution({
        solutionUniqueName: 'TestSolution',
        componentId: '0ea141eb-1e63-7aaa-2aec-32e6c6987016',
        componentType: 'environmentVariableDefinition',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('TestSolution'),
    });
    // Message includes the offending component id so callers can recover
    await expect(
      dvs.removeFromSolution({
        solutionUniqueName: 'TestSolution',
        componentId: '0ea141eb-1e63-7aaa-2aec-32e6c6987016',
        componentType: 'environmentVariableDefinition',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('0ea141eb-1e63-7aaa-2aec-32e6c6987016'),
    });
    // No RemoveSolutionComponent POST should have been issued
    expect(
      fetchMock.mock.calls.find((c) => {
        const u = new URL(String(c[0]));
        return u.pathname.endsWith('/RemoveSolutionComponent');
      }),
    ).toBeUndefined();
  });
});
