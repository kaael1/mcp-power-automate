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
  EnvVarType,
  ListSolutionsInput,
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

  // Create the value row, also inside the same solution.
  const valueRow = await requestDataverse<{
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
