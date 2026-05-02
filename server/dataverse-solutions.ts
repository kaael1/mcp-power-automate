import { PowerAutomateError } from './errors.js';
import { getSession } from './session-store.js';
import {
  type DataverseInstance,
  pickPowerAutomateToken,
  pickPowerPlatformToken,
  requestDataverse,
  resolveInstanceUrl,
} from './dataverse-client.js';
import type {
  AddExistingToSolutionInput,
  ComponentType,
  CreateConnectionReferenceInput,
  CreateEnvironmentVariableInput,
  CreateSolutionInput,
  DeleteEnvironmentVariableInput,
  DeleteSolutionInput,
  EnvVarType,
  GetConnectorSpecInput,
  ListConnectionsInput,
  ListEnvironmentVariablesInput,
  ListSolutionComponentsInput,
  ListSolutionsInput,
  MigrateFlowToSolutionInput,
  PublishCustomizationsInput,
  RemoveFromSolutionInput,
  SetEnvVarValueInput,
} from './schemas.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// Microsoft Dataverse component-type IDs (subset we expose).
// Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/solutioncomponent
const COMPONENT_TYPE_IDS: Record<string, number> = {
  publisher: 59,
  solution: 7600,
  workflow: 29,
  environmentVariableDefinition: 380,
  environmentVariableValue: 381,
  connectionReference: 10112,
};

const COMPONENT_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(COMPONENT_TYPE_IDS).map(([name, id]) => [id, name]),
);

const ENV_VAR_TYPE_OPTIONSET: Record<EnvVarType, number> = {
  string: 100000000,
  number: 100000001,
  boolean: 100000002,
  json: 100000003,
  // 100000004 is dataSource — intentionally not exposed yet
  secret: 100000005,
};

const ENV_VAR_TYPE_LABELS: Record<number, EnvVarType> = {
  100000000: 'string',
  100000001: 'number',
  100000002: 'boolean',
  100000003: 'json',
  100000005: 'secret',
};

const resolveComponentType = (value: ComponentType): number => {
  if (typeof value === 'number') return value;
  const id = COMPONENT_TYPE_IDS[value];
  if (id === undefined) {
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      message: `Unknown componentType "${value}". Pass a numeric Dataverse component-type ID or one of: ${Object.keys(COMPONENT_TYPE_IDS).join(', ')}.`,
      retryable: false,
    });
  }
  return id;
};

const resolveTargetEnvId = (envId?: string): string => {
  if (envId) return envId;
  const session = getSession();
  if (session?.envId) return session.envId;
  throw new PowerAutomateError({
    code: 'NO_SESSION',
    message:
      'No envId provided and no captured session. Pass envId explicitly or open a Power Automate flow in the browser to capture a session.',
    retryable: true,
  });
};

const getInstance = async (envId?: string): Promise<DataverseInstance> => {
  const resolvedEnvId = resolveTargetEnvId(envId);
  return resolveInstanceUrl(resolvedEnvId);
};

const escapeOdataLiteral = (value: string): string => value.replace(/'/g, "''");

interface SolutionRow {
  solutionid: string;
  uniquename: string;
  friendlyname: string;
  version: string;
  ismanaged: boolean;
  isvisible: boolean;
  description?: string | null;
  createdon?: string;
  modifiedon?: string;
  publisherid?: {
    publisherid: string;
    uniquename: string;
    friendlyname: string;
  };
  _publisherid_value?: string;
}

interface PublisherRow {
  publisherid: string;
  uniquename: string;
  friendlyname: string;
  customizationprefix?: string;
}

interface EnvVarDefinitionRow {
  environmentvariabledefinitionid: string;
  schemaname: string;
  displayname?: string;
  type?: number;
  defaultvalue?: string | null;
  description?: string | null;
  isrequired?: boolean;
  environmentvariabledefinition_environmentvariablevalue?: Array<{
    environmentvariablevalueid: string;
    value: string | null;
  }>;
}

const summarizeSolution = (row: SolutionRow) => ({
  solutionId: row.solutionid,
  uniqueName: row.uniquename,
  friendlyName: row.friendlyname,
  version: row.version,
  isManaged: row.ismanaged,
  isVisible: row.isvisible,
  description: row.description ?? null,
  createdOn: row.createdon ?? null,
  modifiedOn: row.modifiedon ?? null,
  publisher:
    row.publisherid ?
      {
        publisherId: row.publisherid.publisherid,
        uniqueName: row.publisherid.uniquename,
        friendlyName: row.publisherid.friendlyname,
      }
    : null,
});

export const listSolutions = async ({ envId, includeManaged, query }: ListSolutionsInput) => {
  const instance = await getInstance(envId);
  const filters: string[] = ['isvisible eq true'];
  if (!includeManaged) filters.push('ismanaged eq false');
  if (query) filters.push(`contains(friendlyname,'${escapeOdataLiteral(query)}')`);

  const result = await requestDataverse<{ value: SolutionRow[] }>({
    instance,
    method: 'GET',
    path: 'solutions',
    query: {
      $filter: filters.join(' and '),
      $select: 'solutionid,uniquename,friendlyname,version,ismanaged,isvisible,description,createdon,modifiedon',
      $expand: 'publisherid($select=publisherid,uniquename,friendlyname)',
      $orderby: 'modifiedon desc',
    },
  });

  return {
    envId: instance.envId,
    solutions: (result.body?.value ?? []).map(summarizeSolution),
  };
};

const findSolutionId = async (instance: DataverseInstance, uniqueName: string): Promise<string> => {
  const result = await requestDataverse<{ value: Array<{ solutionid: string }> }>({
    instance,
    method: 'GET',
    path: 'solutions',
    query: {
      $filter: `uniquename eq '${escapeOdataLiteral(uniqueName)}'`,
      $select: 'solutionid',
      $top: 1,
    },
  });
  const row = result.body?.value?.[0];
  if (!row) {
    throw new PowerAutomateError({
      code: 'SOLUTION_NOT_FOUND',
      message: `Solution with uniqueName "${uniqueName}" not found in environment ${instance.envId}.`,
      retryable: false,
    });
  }
  return row.solutionid;
};

const findPublisherId = async (instance: DataverseInstance, uniqueName: string): Promise<PublisherRow> => {
  const result = await requestDataverse<{ value: PublisherRow[] }>({
    instance,
    method: 'GET',
    path: 'publishers',
    query: {
      $filter: `uniquename eq '${escapeOdataLiteral(uniqueName)}'`,
      $select: 'publisherid,uniquename,friendlyname,customizationprefix',
      $top: 1,
    },
  });
  const row = result.body?.value?.[0];
  if (!row) {
    throw new PowerAutomateError({
      code: 'PUBLISHER_NOT_FOUND',
      message: `Publisher with uniqueName "${uniqueName}" not found in environment ${instance.envId}.`,
      retryable: false,
    });
  }
  return row;
};

export const createSolution = async ({
  envId,
  uniqueName,
  friendlyName,
  version,
  description,
  publisherUniqueName,
}: CreateSolutionInput) => {
  const instance = await getInstance(envId);
  const publisher = await findPublisherId(instance, publisherUniqueName);

  const result = await requestDataverse<SolutionRow>({
    instance,
    method: 'POST',
    path: 'solutions',
    body: {
      uniquename: uniqueName,
      friendlyname: friendlyName,
      version: version || '1.0.0.0',
      ...(description ? { description } : {}),
      'publisherid@odata.bind': `/publishers(${publisher.publisherid})`,
    },
  });

  return {
    envId: instance.envId,
    solution: summarizeSolution(result.body),
  };
};

const findEnvVarDefinition = async (
  instance: DataverseInstance,
  schemaName: string,
): Promise<EnvVarDefinitionRow | null> => {
  const result = await requestDataverse<{ value: EnvVarDefinitionRow[] }>({
    instance,
    method: 'GET',
    path: 'environmentvariabledefinitions',
    query: {
      $filter: `schemaname eq '${escapeOdataLiteral(schemaName)}'`,
      $select: 'environmentvariabledefinitionid,schemaname,displayname,type,defaultvalue,description,isrequired',
      $expand: 'environmentvariabledefinition_environmentvariablevalue($select=environmentvariablevalueid,value)',
      $top: 1,
    },
  });
  return result.body?.value?.[0] ?? null;
};

const summarizeEnvVar = (row: EnvVarDefinitionRow) => {
  const valueRow = row.environmentvariabledefinition_environmentvariablevalue?.[0];
  return {
    definitionId: row.environmentvariabledefinitionid,
    schemaName: row.schemaname,
    displayName: row.displayname ?? null,
    type: row.type !== undefined ? ENV_VAR_TYPE_LABELS[row.type] ?? `unknown:${row.type}` : null,
    defaultValue: row.defaultvalue ?? null,
    description: row.description ?? null,
    isRequired: row.isrequired ?? false,
    currentValue: valueRow?.value ?? null,
    valueId: valueRow?.environmentvariablevalueid ?? null,
  };
};

export const createEnvironmentVariable = async ({
  envId,
  solutionUniqueName,
  schemaName,
  displayName,
  type,
  defaultValue,
  initialValue,
  description,
  isRequired,
}: CreateEnvironmentVariableInput) => {
  const instance = await getInstance(envId);
  // Verify the solution exists up front so we fail fast with a friendly error
  // (the MSCRM.SolutionUniqueName header silently misroutes if invalid).
  await findSolutionId(instance, solutionUniqueName);

  const created = await requestDataverse<EnvVarDefinitionRow>({
    instance,
    method: 'POST',
    path: 'environmentvariabledefinitions',
    headers: {
      'MSCRM.SolutionUniqueName': solutionUniqueName,
    },
    body: {
      schemaname: schemaName,
      displayname: displayName,
      type: ENV_VAR_TYPE_OPTIONSET[type],
      ...(defaultValue !== undefined ? { defaultvalue: defaultValue } : {}),
      ...(description ? { description } : {}),
      ...(isRequired !== undefined ? { isrequired: isRequired } : {}),
    },
  });

  if (initialValue === undefined) {
    return {
      envId: instance.envId,
      definition: summarizeEnvVar(created.body),
    };
  }

  // Create the value row, also inside the same solution. If this fails after
  // the definition was committed, best-effort delete the orphan definition
  // and rethrow with rollback context, so the caller can retry cleanly.
  let valueRow;
  try {
    valueRow = await requestDataverse<{
      environmentvariablevalueid: string;
      value: string;
    }>({
      instance,
      method: 'POST',
      path: 'environmentvariablevalues',
      headers: {
        'MSCRM.SolutionUniqueName': solutionUniqueName,
      },
      body: {
        schemaname: `${schemaName}_value`,
        value: initialValue,
        'EnvironmentVariableDefinitionId@odata.bind': `/environmentvariabledefinitions(${created.body.environmentvariabledefinitionid})`,
      },
    });
  } catch (valueError) {
    const valueErrorMessage = valueError instanceof Error ? valueError.message : String(valueError);
    let rollbackError: unknown = null;
    try {
      await requestDataverse<AnyRecord>({
        instance,
        method: 'DELETE',
        path: `environmentvariabledefinitions(${created.body.environmentvariabledefinitionid})`,
      });
    } catch (caught) {
      rollbackError = caught;
    }

    if (rollbackError) {
      // Rollback failed — server-visible state is inconsistent, callers must
      // clean up the orphan definition manually before any retry.
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new PowerAutomateError({
        code: 'PARTIAL_FAILURE',
        message: `Value-row creation failed for environment variable "${schemaName}"; rollback of the orphan definition ALSO failed (${rollbackMessage}). Definition ${created.body.environmentvariabledefinitionid} is still in solution ${solutionUniqueName} and must be cleaned up manually. Underlying value-row error: ${valueErrorMessage}`,
        retryable: false,
        // Strings (not raw Error instances) so the diagnostics survive
        // JSON.stringify when this error is serialized through the bridge —
        // Error properties are non-enumerable and silently become {}.
        details: {
          orphanDefinitionId: created.body.environmentvariabledefinitionid,
          schemaName,
          solutionUniqueName,
          valueErrorMessage,
          rollbackErrorMessage: rollbackMessage,
        },
      });
    }

    // Rollback succeeded — server state matches pre-call. Caller can retry
    // safely once the underlying value-row failure (network, transient
    // Dataverse 5xx, etc.) is addressed.
    throw new PowerAutomateError({
      code: 'ROLLED_BACK',
      message: `Value-row creation failed for environment variable "${schemaName}"; the orphan definition was rolled back successfully so retry is safe. Underlying error: ${valueErrorMessage}`,
      retryable: true,
      details: { schemaName, solutionUniqueName, valueErrorMessage },
    });
  }

  return {
    envId: instance.envId,
    definition: {
      ...summarizeEnvVar(created.body),
      currentValue: valueRow.body.value,
      valueId: valueRow.body.environmentvariablevalueid,
    },
  };
};

export const setEnvVarValue = async ({ envId, schemaName, value, solutionUniqueName }: SetEnvVarValueInput) => {
  const instance = await getInstance(envId);
  const definition = await findEnvVarDefinition(instance, schemaName);
  if (!definition) {
    throw new PowerAutomateError({
      code: 'ENV_VAR_NOT_FOUND',
      message: `Environment variable definition "${schemaName}" not found in ${instance.envId}.`,
      retryable: false,
    });
  }

  const existing = definition.environmentvariabledefinition_environmentvariablevalue?.[0];
  if (existing) {
    await requestDataverse<AnyRecord>({
      instance,
      method: 'PATCH',
      path: `environmentvariablevalues(${existing.environmentvariablevalueid})`,
      body: { value },
    });
    return {
      envId: instance.envId,
      definitionId: definition.environmentvariabledefinitionid,
      schemaName,
      valueId: existing.environmentvariablevalueid,
      value,
      action: 'updated' as const,
    };
  }

  if (!solutionUniqueName) {
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      message: `Environment variable "${schemaName}" has no value row yet. Pass solutionUniqueName so a new value row can be created in that solution.`,
      retryable: false,
    });
  }
  await findSolutionId(instance, solutionUniqueName);

  // Concurrency narrowing: re-fetch the definition right before the POST so
  // we catch the case where another writer created the value row between
  // our initial GET and now. If a value row exists at this point, switch to
  // a PATCH on it instead of double-creating. Race window is narrowed but
  // not eliminated; for single-user MCP this is acceptable.
  const recheck = await findEnvVarDefinition(instance, schemaName);
  const recheckExisting = recheck?.environmentvariabledefinition_environmentvariablevalue?.[0];
  if (recheckExisting) {
    await requestDataverse<AnyRecord>({
      instance,
      method: 'PATCH',
      path: `environmentvariablevalues(${recheckExisting.environmentvariablevalueid})`,
      body: { value },
    });
    return {
      envId: instance.envId,
      definitionId: definition.environmentvariabledefinitionid,
      schemaName,
      valueId: recheckExisting.environmentvariablevalueid,
      value,
      action: 'updated' as const,
    };
  }

  const created = await requestDataverse<{
    environmentvariablevalueid: string;
    value: string;
  }>({
    instance,
    method: 'POST',
    path: 'environmentvariablevalues',
    headers: {
      'MSCRM.SolutionUniqueName': solutionUniqueName,
    },
    body: {
      schemaname: `${schemaName}_value`,
      value,
      'EnvironmentVariableDefinitionId@odata.bind': `/environmentvariabledefinitions(${definition.environmentvariabledefinitionid})`,
    },
  });

  return {
    envId: instance.envId,
    definitionId: definition.environmentvariabledefinitionid,
    schemaName,
    valueId: created.body.environmentvariablevalueid,
    value: created.body.value,
    action: 'created' as const,
  };
};

interface SolutionComponentRow {
  objectid: string;
  componenttype: number;
}

// Dataverse query URLs cap at ~16KB on some endpoints. Each quoted GUID +
// comma is 39 chars, so an unbounded `Microsoft.Dynamics.CRM.In(...)` filter
// breaks at ~410 ids. Chunking keeps each request well under the cap with
// generous margin for the rest of the URL (instance host, path, $select,
// $expand, etc).
const ID_BATCH_SIZE = 200;

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const buildInFilter = (propertyName: string, ids: string[]): string =>
  `Microsoft.Dynamics.CRM.In(PropertyName='${propertyName}',PropertyValues=[${ids.map((id) => `'${id}'`).join(',')}])`;

interface WorkflowRow {
  workflowid: string;
  name: string;
  category?: number;
  type?: number;
  statecode?: number;
}

const enrichComponents = async (
  instance: DataverseInstance,
  components: SolutionComponentRow[],
): Promise<Array<Record<string, unknown>>> => {
  // Group by component type so we can batch-fetch friendly metadata.
  const byType = new Map<number, string[]>();
  for (const c of components) {
    if (!byType.has(c.componenttype)) byType.set(c.componenttype, []);
    byType.get(c.componenttype)!.push(c.objectid);
  }

  const enriched = new Map<string, Record<string, unknown>>();

  if (byType.has(29)) {
    const ids = byType.get(29)!;
    for (const chunk of chunkArray(ids, ID_BATCH_SIZE)) {
      const result = await requestDataverse<{ value: WorkflowRow[] }>({
        instance,
        method: 'GET',
        path: 'workflows',
        query: {
          $filter: buildInFilter('workflowid', chunk),
          $select: 'workflowid,name,category,type,statecode',
        },
      });
      for (const w of result.body?.value ?? []) {
        enriched.set(w.workflowid, { name: w.name, category: w.category, type: w.type, state: w.statecode });
      }
    }
  }

  if (byType.has(380)) {
    const ids = byType.get(380)!;
    for (const chunk of chunkArray(ids, ID_BATCH_SIZE)) {
      const result = await requestDataverse<{
        value: Array<{ environmentvariabledefinitionid: string; schemaname: string; displayname?: string; type?: number }>;
      }>({
        instance,
        method: 'GET',
        path: 'environmentvariabledefinitions',
        query: {
          $filter: buildInFilter('environmentvariabledefinitionid', chunk),
          $select: 'environmentvariabledefinitionid,schemaname,displayname,type',
        },
      });
      for (const r of result.body?.value ?? []) {
        enriched.set(r.environmentvariabledefinitionid, {
          schemaName: r.schemaname,
          displayName: r.displayname,
          type: r.type !== undefined ? ENV_VAR_TYPE_LABELS[r.type] ?? `unknown:${r.type}` : null,
        });
      }
    }
  }

  return components.map((c) => ({
    objectId: c.objectid,
    componentType: c.componenttype,
    componentTypeName: COMPONENT_TYPE_NAMES[c.componenttype] ?? null,
    ...(enriched.get(c.objectid) || {}),
  }));
};

export const listSolutionComponents = async ({ envId, solutionUniqueName, enrich }: ListSolutionComponentsInput) => {
  const instance = await getInstance(envId);
  const solutionId = await findSolutionId(instance, solutionUniqueName);
  const result = await requestDataverse<{ value: SolutionComponentRow[] }>({
    instance,
    method: 'GET',
    path: 'solutioncomponents',
    query: {
      $filter: `_solutionid_value eq ${solutionId}`,
      $select: 'objectid,componenttype',
    },
  });
  const components = result.body?.value ?? [];
  if (!enrich) {
    return {
      envId: instance.envId,
      solutionUniqueName,
      components: components.map((c) => ({
        objectId: c.objectid,
        componentType: c.componenttype,
        componentTypeName: COMPONENT_TYPE_NAMES[c.componenttype] ?? null,
      })),
    };
  }
  return {
    envId: instance.envId,
    solutionUniqueName,
    components: await enrichComponents(instance, components),
  };
};

export const listEnvironmentVariables = async ({ envId, solutionUniqueName }: ListEnvironmentVariablesInput) => {
  const instance = await getInstance(envId);
  if (solutionUniqueName) {
    const solutionId = await findSolutionId(instance, solutionUniqueName);
    const componentsResult = await requestDataverse<{ value: SolutionComponentRow[] }>({
      instance,
      method: 'GET',
      path: 'solutioncomponents',
      query: {
        $filter: `_solutionid_value eq ${solutionId} and componenttype eq 380`,
        $select: 'objectid',
      },
    });
    const defIds = (componentsResult.body?.value ?? []).map((c) => c.objectid);
    if (defIds.length === 0) {
      return { envId: instance.envId, solutionUniqueName, variables: [] };
    }
    const allDefs: EnvVarDefinitionRow[] = [];
    for (const chunk of chunkArray(defIds, ID_BATCH_SIZE)) {
      const defsResult = await requestDataverse<{ value: EnvVarDefinitionRow[] }>({
        instance,
        method: 'GET',
        path: 'environmentvariabledefinitions',
        query: {
          $filter: buildInFilter('environmentvariabledefinitionid', chunk),
          $select: 'environmentvariabledefinitionid,schemaname,displayname,type,defaultvalue,description,isrequired',
          $expand: 'environmentvariabledefinition_environmentvariablevalue($select=environmentvariablevalueid,value)',
        },
      });
      allDefs.push(...(defsResult.body?.value ?? []));
    }
    return {
      envId: instance.envId,
      solutionUniqueName,
      variables: allDefs.map(summarizeEnvVar),
    };
  }
  const allDefs = await requestDataverse<{ value: EnvVarDefinitionRow[] }>({
    instance,
    method: 'GET',
    path: 'environmentvariabledefinitions',
    query: {
      $select: 'environmentvariabledefinitionid,schemaname,displayname,type,defaultvalue,description,isrequired',
      $expand: 'environmentvariabledefinition_environmentvariablevalue($select=environmentvariablevalueid,value)',
    },
  });
  return {
    envId: instance.envId,
    solutionUniqueName: null,
    variables: (allDefs.body?.value ?? []).map(summarizeEnvVar),
  };
};

export const addExistingToSolution = async ({
  envId,
  solutionUniqueName,
  componentId,
  componentType,
  addRequiredComponents,
  doNotIncludeSubcomponents,
}: AddExistingToSolutionInput) => {
  const instance = await getInstance(envId);
  const numericType = resolveComponentType(componentType);

  await requestDataverse<AnyRecord>({
    instance,
    method: 'POST',
    path: 'AddSolutionComponent',
    body: {
      ComponentId: componentId,
      ComponentType: numericType,
      SolutionUniqueName: solutionUniqueName,
      AddRequiredComponents: addRequiredComponents ?? true,
      DoNotIncludeSubcomponents: doNotIncludeSubcomponents ?? false,
    },
  });

  return {
    envId: instance.envId,
    solutionUniqueName,
    componentId,
    componentType: numericType,
    componentTypeName: COMPONENT_TYPE_NAMES[numericType] ?? null,
    addRequiredComponents: addRequiredComponents ?? true,
    ok: true,
  };
};

export const removeFromSolution = async ({
  envId,
  solutionUniqueName,
  componentId,
  componentType,
}: RemoveFromSolutionInput) => {
  const instance = await getInstance(envId);
  const numericType = resolveComponentType(componentType);
  const solutionId = await findSolutionId(instance, solutionUniqueName);

  // Sanity check: confirm the (solution × component) link exists before issuing
  // the action — produces a clearer error than letting RemoveSolutionComponent
  // surface a generic failure.
  const lookup = await requestDataverse<{ value: Array<{ solutioncomponentid: string }> }>({
    instance,
    method: 'GET',
    path: 'solutioncomponents',
    query: {
      $filter: `_solutionid_value eq ${solutionId} and objectid eq ${componentId} and componenttype eq ${numericType}`,
      $select: 'solutioncomponentid',
      $top: 1,
    },
  });
  if (!lookup.body?.value?.[0]) {
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      message: `Component ${componentId} (type ${numericType}) is not in solution "${solutionUniqueName}".`,
      retryable: false,
    });
  }
  // RemoveSolutionComponent is the unbound action documented for this purpose.
  // Note: requires Delete privilege on the SolutionComponent system table —
  // some non-admin users see "ComponentId is not a valid parameter" or similar
  // misleading errors when the privilege is missing. Use delete_solution
  // force=true as a workaround when this fails in restricted tenants.
  await requestDataverse<AnyRecord>({
    instance,
    method: 'POST',
    path: 'RemoveSolutionComponent',
    body: {
      ComponentId: componentId,
      ComponentType: numericType,
      SolutionUniqueName: solutionUniqueName,
    },
  });
  return {
    envId: instance.envId,
    solutionUniqueName,
    componentId,
    componentType: numericType,
    componentTypeName: COMPONENT_TYPE_NAMES[numericType] ?? null,
    ok: true,
  };
};

export const deleteSolution = async ({ envId, uniqueName, force }: DeleteSolutionInput) => {
  const instance = await getInstance(envId);
  const solutionId = await findSolutionId(instance, uniqueName);

  if (!force) {
    const result = await requestDataverse<{ value: SolutionComponentRow[] }>({
      instance,
      method: 'GET',
      path: 'solutioncomponents',
      query: {
        $filter: `_solutionid_value eq ${solutionId}`,
        $select: 'objectid',
        $top: 1,
      },
    });
    const count = result.body?.value?.length ?? 0;
    if (count > 0) {
      throw new PowerAutomateError({
        code: 'INVALID_REQUEST',
        message:
          `Solution "${uniqueName}" still contains components. Pass force: true to delete anyway, or remove components first.`,
        retryable: false,
      });
    }
  }

  await requestDataverse<AnyRecord>({
    instance,
    method: 'DELETE',
    path: `solutions(${solutionId})`,
  });
  return { envId: instance.envId, uniqueName, solutionId, ok: true };
};

export const deleteEnvironmentVariable = async ({ envId, schemaName }: DeleteEnvironmentVariableInput) => {
  const instance = await getInstance(envId);
  const definition = await findEnvVarDefinition(instance, schemaName);
  if (!definition) {
    throw new PowerAutomateError({
      code: 'ENV_VAR_NOT_FOUND',
      message: `Environment variable "${schemaName}" not found.`,
      retryable: false,
    });
  }
  // Delete value rows first to avoid orphans.
  for (const v of definition.environmentvariabledefinition_environmentvariablevalue ?? []) {
    await requestDataverse<AnyRecord>({
      instance,
      method: 'DELETE',
      path: `environmentvariablevalues(${v.environmentvariablevalueid})`,
    });
  }
  await requestDataverse<AnyRecord>({
    instance,
    method: 'DELETE',
    path: `environmentvariabledefinitions(${definition.environmentvariabledefinitionid})`,
  });
  return {
    envId: instance.envId,
    schemaName,
    definitionId: definition.environmentvariabledefinitionid,
    deletedValueRows: (definition.environmentvariabledefinition_environmentvariablevalue ?? []).length,
    ok: true,
  };
};

// Convert a legacy (non-solution) Power Automate cloud flow into a
// solution-aware Dataverse workflow row, by adding it to the named
// solution. Calls the same /migrateFlows endpoint the maker portal uses
// when a user clicks "Add existing → Cloud flow → Outside Dataverse".
//
// MS Learn flags api.flow.microsoft.com as "unsupported" in their
// public-API guidance, but this is the path the portal itself uses, so
// it's the only currently-known automation path for this conversion.
//
// Token: needs an api.flow.microsoft.com / service.flow.microsoft.com /
// service.powerapps.com audience. The session's legacyToken or apiToken
// usually qualifies; otherwise the token-audit pool is searched.
export const migrateFlowToSolution = async ({
  envId,
  flowId,
  solutionUniqueName,
}: MigrateFlowToSolutionInput) => {
  const resolvedEnvId = resolveTargetEnvId(envId);
  const instance = await getInstance(resolvedEnvId);
  // Surface a friendly error if the solution doesn't exist before we burn
  // a (slow) call to migrateFlows that would 404 with a less clear message.
  const solutionId = await findSolutionId(instance, solutionUniqueName);

  const flowToken = pickPowerAutomateToken();
  if (!flowToken) {
    throw new PowerAutomateError({
      code: 'LEGACY_TOKEN_MISSING',
      message:
        `No Power Automate (api.flow.microsoft.com / service.powerapps.com) token captured. ` +
        `Open https://make.powerautomate.com/environments/${resolvedEnvId}/flows in the browser ` +
        `with the extension enabled to mint one, then retry.`,
      retryable: true,
    });
  }

  // Endpoint shape captured from the maker portal's actual call (via
  // Playwright network capture). Uses Microsoft.Flow namespace and
  // api-version 2018-10-01. Body is the bare flowId GUID — NOT a full
  // resource path; sending a path here returns 404 FlowNotFound even
  // though the request is otherwise valid. (The dev.to article that
  // documented this endpoint had the body shape wrong.)
  const url =
    `https://api.flow.microsoft.com/providers/Microsoft.Flow/environments/` +
    `${encodeURIComponent(resolvedEnvId)}/solutions/${encodeURIComponent(solutionId)}` +
    `/migrateFlows?api-version=2018-10-01`;

  // Audit-pool tokens carry "Bearer " in their token field, session-derived
  // candidates strip it. Normalize so the header is always well-formed.
  const rawJwt = flowToken.token.replace(/^Bearer\s+/i, '');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rawJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ flowsToMigrate: [flowId] }),
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PowerAutomateError({
        code: 'SESSION_EXPIRED',
        message:
          `migrateFlows returned ${response.status}. The Power Automate token is expired or insufficient. ` +
          `Refresh the maker portal page so the extension can recapture a fresh token.`,
        retryable: true,
      });
    }
    const parsed = body as AnyRecord | string | null;
    const message =
      (parsed as AnyRecord | null)?.error?.message ||
      (parsed as AnyRecord | null)?.message ||
      (typeof parsed === 'string' && parsed) ||
      `migrateFlows failed with ${response.status} ${response.statusText}.`;
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      message: String(message),
      details: { status: response.status, body },
      retryable: false,
    });
  }

  return {
    envId: resolvedEnvId,
    flowId,
    solutionUniqueName,
    solutionId,
    response: body,
    ok: true,
  };
};

// List connections in the environment via the per-environment Power
// Platform API (the same call the maker portal's Connections page makes,
// captured via Playwright). Endpoint shape:
//   {sessionApiUrl}/connectivity/connections?api-version=1
// Token: api.powerplatform.com audience. Filter by connectorApiName client-
// side (e.g. "shared_office365" or "shared_teams").
export const listConnections = async ({ envId, connectorApiName }: ListConnectionsInput) => {
  const resolvedEnvId = resolveTargetEnvId(envId);
  const session = getSession();
  const apiUrl = session?.apiUrl;
  if (!apiUrl) {
    throw new PowerAutomateError({
      code: 'NO_SESSION',
      message:
        `No captured session.apiUrl available; needed for the per-environment ` +
        `Power Platform connectivity endpoint. Open a Power Automate flow in the ` +
        `browser with the extension enabled to capture one.`,
      retryable: true,
    });
  }
  const ppToken = pickPowerPlatformToken();
  if (!ppToken) {
    throw new PowerAutomateError({
      code: 'BAP_TOKEN_MISSING',
      message:
        `No api.powerplatform.com token captured. Open ` +
        `https://make.powerautomate.com/environments/${resolvedEnvId}/connections ` +
        `with the extension enabled to mint one.`,
      retryable: true,
    });
  }

  const base = apiUrl.replace(/\/+$/, '');
  const url = `${base}/connectivity/connections?api-version=1`;

  const rawJwt = ppToken.token.replace(/^Bearer\s+/i, '');
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${rawJwt}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PowerAutomateError({
        code: 'SESSION_EXPIRED',
        message: `list connections returned ${response.status}. Refresh the maker portal page to recapture a fresh token.`,
        retryable: true,
      });
    }
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      message: `list connections failed: ${response.status} ${response.statusText}`,
      details: { status: response.status, body },
      retryable: false,
    });
  }

  const items = ((body as AnyRecord)?.value ?? []) as AnyRecord[];
  const allConnections = items.map((c) => {
    const props = (c?.properties as AnyRecord) ?? {};
    const apiId = (props.apiId as string | undefined) || ((props.api as AnyRecord)?.id as string | undefined);
    return {
      connectionName: c?.name as string | undefined,
      displayName: props.displayName as string | undefined,
      connectorName: apiId ? String(apiId).split('/').pop() : undefined,
      connectorId: apiId,
      status: Array.isArray(props.statuses) && props.statuses[0]?.status,
      createdTime: props.createdTime as string | undefined,
      lastModifiedTime: props.lastModifiedTime as string | undefined,
      ownerEmail: (props.createdBy as AnyRecord)?.email as string | undefined,
    };
  });

  const connections = connectorApiName
    ? allConnections.filter((c) => c.connectorName === connectorApiName)
    : allConnections;

  return { envId: resolvedEnvId, count: connections.length, connections };
};

// Create a Dataverse connection reference row in the named solution. When
// connectionId is supplied, the reference is bound to that real connection
// at creation time, so a solution-aware flow can use it without a manual
// "fix connections" step in the maker portal. The schemaName must follow
// <publisherprefix>_<name> per Dataverse rules.
export const createConnectionReference = async ({
  envId,
  solutionUniqueName,
  schemaName,
  displayName,
  connectorId,
  connectionId,
}: CreateConnectionReferenceInput) => {
  const instance = await getInstance(envId);
  await findSolutionId(instance, solutionUniqueName);

  const body: AnyRecord = {
    connectionreferencedisplayname: displayName,
    connectionreferencelogicalname: schemaName,
    connectorid: connectorId,
  };
  if (connectionId) {
    body.connectionid = connectionId;
  }

  const created = await requestDataverse<AnyRecord>({
    instance,
    method: 'POST',
    path: 'connectionreferences',
    body,
    headers: { 'MSCRM.SolutionUniqueName': solutionUniqueName },
  });

  const row = created.body as AnyRecord;
  return {
    envId: instance.envId,
    connectionReference: {
      connectionReferenceId: row?.connectionreferenceid,
      schemaName: row?.connectionreferencelogicalname,
      displayName: row?.connectionreferencedisplayname,
      connectorId: row?.connectorid,
      connectionId: row?.connectionid ?? null,
    },
    solutionUniqueName,
  };
};

// Fetch a connector's Swagger so callers can look up valid operation IDs
// and parameter shapes BEFORE authoring an OpenApiConnection action — far
// faster than guess-and-retry on apply_flow_update. Endpoint:
//   https://api.flow.microsoft.com/providers/Microsoft.PowerApps/apis/{apiName}?$expand=swagger&api-version=2018-08-01
//
// Without operationId: returns a compact list of operations
// (operationId, summary, description, method, path).
// With operationId: returns the full operation object including parameters
// (name, in, type, required, description) and responses.
export const getConnectorSpec = async ({ envId, apiName, operationId }: GetConnectorSpecInput) => {
  const resolvedEnvId = resolveTargetEnvId(envId);
  const flowToken = pickPowerAutomateToken();
  if (!flowToken) {
    throw new PowerAutomateError({
      code: 'LEGACY_TOKEN_MISSING',
      message:
        `No Power Automate token captured. Open ` +
        `https://make.powerautomate.com/environments/${resolvedEnvId}/flows ` +
        `with the extension enabled to mint one.`,
      retryable: true,
    });
  }

  const url =
    `https://api.flow.microsoft.com/providers/Microsoft.PowerApps/apis/` +
    `${encodeURIComponent(apiName)}?$expand=swagger&api-version=2018-08-01`;

  const rawJwt = flowToken.token.replace(/^Bearer\s+/i, '');
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${rawJwt}`, Accept: 'application/json' },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PowerAutomateError({
        code: 'SESSION_EXPIRED',
        message: `Connector spec fetch returned ${response.status}. Refresh the maker portal page to recapture a fresh token.`,
        retryable: true,
      });
    }
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      message: `Connector spec fetch failed: ${response.status} ${response.statusText}`,
      details: { status: response.status, body },
      retryable: false,
    });
  }

  const root = body as AnyRecord;
  const props = (root?.properties as AnyRecord) ?? {};
  const swagger = (props.swagger as AnyRecord) ?? {};
  const paths = (swagger.paths as AnyRecord) ?? {};

  // Walk Swagger paths → method dictionary → operation object.
  // Each operation has: operationId, summary, description, parameters,
  // responses, x-ms-* extensions. Build a flat map keyed by operationId.
  const operations: Record<string, AnyRecord & { method: string; path: string }> = {};
  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [method, op] of Object.entries(methods as AnyRecord)) {
      if (!op || typeof op !== 'object') continue;
      const opAny = op as AnyRecord;
      const opId = opAny.operationId as string | undefined;
      if (!opId) continue;
      operations[opId] = { ...opAny, method: method.toUpperCase(), path };
    }
  }

  if (operationId) {
    const op = operations[operationId];
    if (!op) {
      const all = Object.keys(operations).sort();
      throw new PowerAutomateError({
        code: 'INVALID_REQUEST',
        message: `Operation '${operationId}' not found in API '${apiName}'.`,
        details: { availableOperations: all },
        retryable: false,
      });
    }
    return {
      apiName,
      operationId,
      method: op.method,
      path: op.path,
      summary: op.summary,
      description: op.description,
      parameters: op.parameters,
      responses: op.responses,
    };
  }

  const summary = Object.entries(operations)
    .map(([id, op]) => ({
      operationId: id,
      method: op.method,
      path: op.path,
      summary: op.summary as string | undefined,
      description: op.description as string | undefined,
      deprecated: op.deprecated as boolean | undefined,
    }))
    .sort((a, b) => a.operationId.localeCompare(b.operationId));

  return {
    apiName,
    connectorDisplayName: props.displayName as string | undefined,
    operationCount: summary.length,
    operations: summary,
  };
};

export const publishCustomizations = async ({ envId, parameterXml }: PublishCustomizationsInput) => {
  const instance = await getInstance(envId);
  if (parameterXml) {
    await requestDataverse<AnyRecord>({
      instance,
      method: 'POST',
      path: 'PublishXml',
      body: { ParameterXml: parameterXml },
    });
    return { envId: instance.envId, scope: 'scoped' as const, ok: true };
  }
  await requestDataverse<AnyRecord>({
    instance,
    method: 'POST',
    path: 'PublishAllXml',
  });
  return { envId: instance.envId, scope: 'all' as const, ok: true };
};
