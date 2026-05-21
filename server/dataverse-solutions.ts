import { getSession } from './session-store.js';
import { PowerAutomateError } from './errors.js';
import {
  type DataverseInstance,
  requestDataverse,
  requestDataverseCollection,
  resolveInstanceUrl,
} from './dataverse-client.js';
import type {
  AddFlowToSolutionInput,
  CreateFlowInSolutionInput,
  ListEnvironmentVariablesInput,
  ListSolutionComponentsInput,
  ListSolutionsInput,
} from './schemas.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const COMPONENT_TYPE_NAMES: Record<number, string> = {
  29: 'workflow',
  59: 'publisher',
  380: 'environmentVariableDefinition',
  381: 'environmentVariableValue',
  7600: 'solution',
  10112: 'connectionReference',
};

const ENV_VAR_TYPE_LABELS: Record<number, string> = {
  100000000: 'string',
  100000001: 'number',
  100000002: 'boolean',
  100000003: 'json',
  100000005: 'secret',
};

const ID_BATCH_SIZE = 200;
const FLOW_COMPONENT_TYPE = 29;

const resolveTargetEnvId = (envId?: string) => {
  if (envId) return envId;

  const session = getSession();
  if (session?.envId) return session.envId;

  throw new PowerAutomateError({
    code: 'NO_SESSION',
    message: 'No envId was provided and no captured browser session is available.',
    retryable: true,
  });
};

const getInstance = async (envId?: string): Promise<DataverseInstance> => resolveInstanceUrl(resolveTargetEnvId(envId));

const escapeOdataLiteral = (value: string) => value.replace(/'/g, "''");

interface SolutionRow {
  createdon?: string;
  description?: string | null;
  friendlyname: string;
  ismanaged: boolean;
  isvisible: boolean;
  modifiedon?: string;
  publisherid?: {
    friendlyname: string;
    publisherid: string;
    uniquename: string;
  };
  solutionid: string;
  uniquename: string;
  version: string;
}

interface SolutionComponentRow {
  componenttype: number;
  objectid: string;
}

interface WorkflowRow {
  category?: number;
  name: string;
  statecode?: number;
  type?: number;
  workflowid: string;
}

interface EnvVarDefinitionRow {
  defaultvalue?: string | null;
  description?: string | null;
  displayname?: string;
  environmentvariabledefinition_environmentvariablevalue?: Array<{
    environmentvariablevalueid: string;
    value: string | null;
  }>;
  environmentvariabledefinitionid: string;
  isrequired?: boolean;
  schemaname: string;
  type?: number;
}

const summarizeSolution = (row: SolutionRow) => ({
  createdOn: row.createdon ?? null,
  description: row.description ?? null,
  friendlyName: row.friendlyname,
  isManaged: row.ismanaged,
  isVisible: row.isvisible,
  modifiedOn: row.modifiedon ?? null,
  publisher:
    row.publisherid ?
      {
        friendlyName: row.publisherid.friendlyname,
        publisherId: row.publisherid.publisherid,
        uniqueName: row.publisherid.uniquename,
      }
    : null,
  solutionId: row.solutionid,
  uniqueName: row.uniquename,
  version: row.version,
});

export const listSolutions = async ({ envId, includeManaged, query }: ListSolutionsInput = {}) => {
  const instance = await getInstance(envId);
  const filters = ['isvisible eq true'];

  if (!includeManaged) filters.push('ismanaged eq false');
  if (query) filters.push(`contains(friendlyname,'${escapeOdataLiteral(query)}')`);

  const result = await requestDataverseCollection<SolutionRow>({
    instance,
    path: 'solutions',
    query: {
      $expand: 'publisherid($select=publisherid,uniquename,friendlyname)',
      $filter: filters.join(' and '),
      $orderby: 'modifiedon desc',
      $select: 'solutionid,uniquename,friendlyname,version,ismanaged,isvisible,description,createdon,modifiedon',
    },
  });

  return {
    envId: instance.envId,
    source: 'dataverse',
    solutions: result.value.map(summarizeSolution),
  };
};

const findSolution = async (instance: DataverseInstance, uniqueName: string) => {
  const result = await requestDataverse<{
    value: Array<Pick<SolutionRow, 'friendlyname' | 'ismanaged' | 'solutionid' | 'uniquename'>>;
  }>({
    instance,
    method: 'GET',
    path: 'solutions',
    query: {
      $filter: `uniquename eq '${escapeOdataLiteral(uniqueName)}'`,
      $select: 'solutionid,uniquename,friendlyname,ismanaged',
      $top: 1,
    },
  });
  const row = result.body?.value?.[0];

  if (!row) {
    throw new PowerAutomateError({
      code: 'SOLUTION_NOT_FOUND',
      message: `Solution with unique name "${uniqueName}" was not found in environment ${instance.envId}.`,
      retryable: false,
    });
  }

  return row;
};

const findSolutionId = async (instance: DataverseInstance, uniqueName: string) =>
  (await findSolution(instance, uniqueName)).solutionid;

const assertUnmanagedSolution = (solution: Pick<SolutionRow, 'ismanaged' | 'solutionid'>, solutionUniqueName: string) => {
  if (solution.ismanaged) {
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      details: {
        solutionId: solution.solutionid,
        solutionUniqueName,
      },
      message: `Solution "${solutionUniqueName}" is managed. Add flows only to unmanaged solutions.`,
      retryable: false,
    });
  }
};

export const prepareFlowSolutionTarget = async ({
  envId,
  solutionUniqueName,
}: Pick<AddFlowToSolutionInput, 'envId' | 'solutionUniqueName'>) => {
  const instance = await getInstance(envId);
  const solution = await findSolution(instance, solutionUniqueName);
  assertUnmanagedSolution(solution, solutionUniqueName);

  return {
    envId: instance.envId,
    solution: {
      friendlyName: solution.friendlyname,
      isManaged: solution.ismanaged,
      solutionId: solution.solutionid,
      uniqueName: solution.uniquename,
    },
  };
};

const buildBlankRequestDefinition = () => ({
  $schema:
    'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  actions: {
    Response: {
      inputs: {
        body: {
          ok: true,
        },
        statusCode: 200,
      },
      kind: 'Http',
      metadata: {},
      runAfter: {},
      type: 'Response',
    },
  },
  contentVersion: '1.0.0.0',
  outputs: {},
  parameters: {
    $authentication: {
      defaultValue: {},
      type: 'SecureObject',
    },
    $connections: {
      defaultValue: {},
      type: 'Object',
    },
  },
  triggers: {
    manual: {
      inputs: {
        schema: {
          properties: {},
          required: [],
          type: 'object',
        },
      },
      kind: 'Button',
      metadata: {},
      type: 'Request',
    },
  },
});

const buildBlankRecurrenceDefinition = () => ({
  $schema:
    'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  actions: {
    Compose: {
      inputs: 'Scheduled run completed.',
      metadata: {},
      runAfter: {},
      type: 'Compose',
    },
  },
  contentVersion: '1.0.0.0',
  outputs: {},
  parameters: {
    $authentication: {
      defaultValue: {},
      type: 'SecureObject',
    },
    $connections: {
      defaultValue: {},
      type: 'Object',
    },
  },
  triggers: {
    Recurrence: {
      metadata: {},
      recurrence: {
        frequency: 'Day',
        interval: 1,
      },
      type: 'Recurrence',
    },
  },
});

const extractWorkflowIdFromEntityId = (entityId: string | undefined) => {
  const match = entityId?.match(/workflows\(([^)]+)\)/i);
  return match?.[1] || null;
};

const createWorkflowClientData = (definition: AnyRecord) =>
  JSON.stringify({
    properties: {
      connectionReferences: {},
      definition,
    },
    schemaVersion: '1.0.0.0',
  });

export const addFlowToSolution = async ({
  addRequiredComponents = false,
  doNotIncludeSubcomponents,
  envId,
  flowId,
  solutionUniqueName,
}: AddFlowToSolutionInput) => {
  const instance = await getInstance(envId);
  const solution = await findSolution(instance, solutionUniqueName);
  assertUnmanagedSolution(solution, solutionUniqueName);
  const body: AnyRecord = {
    AddRequiredComponents: addRequiredComponents,
    ComponentId: flowId,
    ComponentType: FLOW_COMPONENT_TYPE,
    SolutionUniqueName: solutionUniqueName,
  };

  if (doNotIncludeSubcomponents !== undefined) {
    body.DoNotIncludeSubcomponents = doNotIncludeSubcomponents;
  }

  const result = await requestDataverse<AnyRecord | null>({
    body,
    instance,
    method: 'POST',
    path: 'AddSolutionComponent',
  });

  return {
    addRequiredComponents,
    componentType: FLOW_COMPONENT_TYPE,
    componentTypeName: COMPONENT_TYPE_NAMES[FLOW_COMPONENT_TYPE],
    doNotIncludeSubcomponents: doNotIncludeSubcomponents ?? null,
    envId: instance.envId,
    flowId,
    response: result.body ?? null,
    solution: {
      friendlyName: solution.friendlyname,
      isManaged: solution.ismanaged,
      solutionId: solution.solutionid,
      uniqueName: solution.uniquename,
    },
    source: 'dataverse',
  };
};

export const createFlowInSolution = async ({
  addRequiredComponents = false,
  displayName,
  doNotIncludeSubcomponents,
  envId,
  solutionUniqueName,
  triggerType = 'request',
}: CreateFlowInSolutionInput) => {
  const target = await prepareFlowSolutionTarget({ envId, solutionUniqueName });
  const instance = await getInstance(target.envId);
  const definition =
    triggerType === 'recurrence' ? buildBlankRecurrenceDefinition() : buildBlankRequestDefinition();
  const created = await requestDataverse<null>({
    body: {
      category: 5,
      clientdata: createWorkflowClientData(definition),
      description: 'Created by MCP Power Automate.',
      name: displayName,
      primaryentity: 'none',
      type: 1,
    },
    instance,
    method: 'POST',
    path: 'workflows',
  });
  const flowId = extractWorkflowIdFromEntityId(created.headers['odata-entityid']);

  if (!flowId) {
    throw new PowerAutomateError({
      code: 'UNKNOWN',
      details: {
        headers: created.headers,
      },
      message: 'Dataverse did not return a workflow id for the created cloud flow.',
      retryable: false,
    });
  }

  const solutionComponent = await addFlowToSolution({
    addRequiredComponents,
    doNotIncludeSubcomponents,
    envId: instance.envId,
    flowId,
    solutionUniqueName,
  });

  return {
    displayName,
    envId: instance.envId,
    flow: {
      connectionReferences: {},
      definition,
    },
    flowId,
    solutionComponent,
    source: 'dataverse',
  };
};

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const buildInFilter = (propertyName: string, ids: string[]) =>
  `Microsoft.Dynamics.CRM.In(PropertyName='${propertyName}',PropertyValues=[${ids.map((id) => `'${id}'`).join(',')}])`;

const summarizeEnvVar = (row: EnvVarDefinitionRow) => {
  const valueRow = row.environmentvariabledefinition_environmentvariablevalue?.[0];
  const isSecret = row.type === 100000005;

  return {
    currentValue: isSecret ? null : (valueRow?.value ?? null),
    defaultValue: isSecret ? null : (row.defaultvalue ?? null),
    definitionId: row.environmentvariabledefinitionid,
    description: row.description ?? null,
    displayName: row.displayname ?? null,
    isRequired: row.isrequired ?? false,
    schemaName: row.schemaname,
    type: row.type === undefined ? null : (ENV_VAR_TYPE_LABELS[row.type] ?? `unknown:${row.type}`),
    valueId: valueRow?.environmentvariablevalueid ?? null,
  };
};

const enrichComponents = async (instance: DataverseInstance, components: SolutionComponentRow[]) => {
  const byType = new Map<number, string[]>();

  for (const component of components) {
    byType.set(component.componenttype, [...(byType.get(component.componenttype) || []), component.objectid]);
  }

  const enriched = new Map<string, AnyRecord>();

  for (const chunk of chunkArray(byType.get(29) || [], ID_BATCH_SIZE)) {
    const result = await requestDataverseCollection<WorkflowRow>({
      instance,
      path: 'workflows',
      query: {
        $filter: buildInFilter('workflowid', chunk),
        $select: 'workflowid,name,category,type,statecode',
      },
    });

    for (const workflow of result.value) {
      enriched.set(workflow.workflowid, {
        category: workflow.category ?? null,
        name: workflow.name,
        state: workflow.statecode ?? null,
        type: workflow.type ?? null,
      });
    }
  }

  for (const chunk of chunkArray(byType.get(380) || [], ID_BATCH_SIZE)) {
    const result = await requestDataverseCollection<{
      displayname?: string;
      environmentvariabledefinitionid: string;
      schemaname: string;
      type?: number;
    }>({
      instance,
      path: 'environmentvariabledefinitions',
      query: {
        $filter: buildInFilter('environmentvariabledefinitionid', chunk),
        $select: 'environmentvariabledefinitionid,schemaname,displayname,type',
      },
    });

    for (const definition of result.value) {
      enriched.set(definition.environmentvariabledefinitionid, {
        displayName: definition.displayname ?? null,
        schemaName: definition.schemaname,
        type: definition.type === undefined ? null : (ENV_VAR_TYPE_LABELS[definition.type] ?? `unknown:${definition.type}`),
      });
    }
  }

  return components.map((component) => ({
    componentType: component.componenttype,
    componentTypeName: COMPONENT_TYPE_NAMES[component.componenttype] ?? null,
    objectId: component.objectid,
    ...(enriched.get(component.objectid) || {}),
  }));
};

export const listSolutionComponents = async ({
  enrich,
  envId,
  solutionUniqueName,
}: ListSolutionComponentsInput) => {
  const instance = await getInstance(envId);
  const solutionId = await findSolutionId(instance, solutionUniqueName);
  const result = await requestDataverseCollection<SolutionComponentRow>({
    instance,
    path: 'solutioncomponents',
    query: {
      $filter: `_solutionid_value eq ${solutionId}`,
      $select: 'objectid,componenttype',
    },
  });
  const components = result.value;

  return {
    components:
      enrich ?
        await enrichComponents(instance, components)
      : components.map((component) => ({
          componentType: component.componenttype,
          componentTypeName: COMPONENT_TYPE_NAMES[component.componenttype] ?? null,
          objectId: component.objectid,
        })),
    envId: instance.envId,
    solutionUniqueName,
  };
};

const listEnvironmentVariableDefinitions = async (instance: DataverseInstance, ids?: string[]) => {
  const commonQuery = {
    $expand: 'environmentvariabledefinition_environmentvariablevalue($select=environmentvariablevalueid,value)',
    $select: 'environmentvariabledefinitionid,schemaname,displayname,type,defaultvalue,description,isrequired',
  };

  if (!ids) {
    const result = await requestDataverseCollection<EnvVarDefinitionRow>({
      instance,
      path: 'environmentvariabledefinitions',
      query: commonQuery,
    });

    return result.value;
  }

  const definitions: EnvVarDefinitionRow[] = [];

  for (const chunk of chunkArray(ids, ID_BATCH_SIZE)) {
    const result = await requestDataverseCollection<EnvVarDefinitionRow>({
      instance,
      path: 'environmentvariabledefinitions',
      query: {
        ...commonQuery,
        $filter: buildInFilter('environmentvariabledefinitionid', chunk),
      },
    });
    definitions.push(...result.value);
  }

  return definitions;
};

export const listEnvironmentVariables = async ({ envId, solutionUniqueName }: ListEnvironmentVariablesInput = {}) => {
  const instance = await getInstance(envId);

  if (!solutionUniqueName) {
    return {
      envId: instance.envId,
      solutionUniqueName: null,
      variables: (await listEnvironmentVariableDefinitions(instance)).map(summarizeEnvVar),
    };
  }

  const solutionId = await findSolutionId(instance, solutionUniqueName);
  const componentsResult = await requestDataverseCollection<SolutionComponentRow>({
    instance,
    path: 'solutioncomponents',
    query: {
      $filter: `_solutionid_value eq ${solutionId} and componenttype eq 380`,
      $select: 'objectid',
    },
  });
  const definitionIds = componentsResult.value.map((component) => component.objectid);

  return {
    envId: instance.envId,
    solutionUniqueName,
    variables: (await listEnvironmentVariableDefinitions(instance, definitionIds)).map(summarizeEnvVar),
  };
};
