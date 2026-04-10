import type { FlowCatalog } from './schemas.js';
import { flowCatalogSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'flow-catalog';
const STORE_VERSION = 1;

let flowCatalog: FlowCatalog | null = null;

export const getFlowCatalog = () => flowCatalog;

export const getFlowCatalogForEnv = (envId: string) => {
  if (!flowCatalog || flowCatalog.envId !== envId) return null;
  return flowCatalog;
};

export const loadFlowCatalog = async () => {
  flowCatalog = await readVersionedStore({
    filePath: getDataFilePath('flow-catalog.json'),
    migrate: (value) => flowCatalogSchema.parse(value),
    name: STORE_NAME,
    parse: (value) => flowCatalogSchema.parse(value),
    version: STORE_VERSION,
  });
  return flowCatalog;
};

export const saveFlowCatalog = async (catalog: FlowCatalog) => {
  const parsed = flowCatalogSchema.parse(catalog);
  await writeVersionedStore({
    data: parsed,
    filePath: getDataFilePath('flow-catalog.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  flowCatalog = parsed;
  return parsed;
};
