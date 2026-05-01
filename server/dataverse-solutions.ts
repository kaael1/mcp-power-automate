import { PowerAutomateError } from './errors.js';
import { getSession } from './session-store.js';
import {
  type DataverseInstance,
  requestDataverse,
  resolveInstanceUrl,
} from './dataverse-client.js';
import type {
  AddExistingToSolutionInput,
  ComponentType,
  CreateEnvironmentVariableInput,
  CreateSolutionInput,
  DeleteEnvironmentVariableInput,
  DeleteSolutionInput,
  EnvVarType,
  ListEnvironmentVariablesInput,
  ListSolutionComponentsInput,
  ListSolutionsInput,
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
    let rollbackNote = 'definition rolled back.';
    try {
      await requestDataverse<AnyRecord>({
        instance,
        method: 'DELETE',
        path: `environmentvariabledefinitions(${created.body.environmentvariabledefinitionid})`,
      });
    } catch (rollbackError) {
      rollbackNote = `definition rollback FAILED: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)} — definition ${created.body.environmentvariabledefinitionid} ("${schemaName}") is still in solution ${solutionUniqueName} and must be cleaned up manually.`;
    }
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      message: `Value-row creation failed for environment variable "${schemaName}"; ${rollbackNote} Underlying error: ${valueError instanceof Error ? valueError.message : String(valueError)}`,
      retryable: false,
      details: valueError,
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
