import type { DataverseOrgMap, DataverseOrgRecord } from './schemas.js';
import { dataverseOrgMapSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'dataverse-org-map';
const STORE_VERSION = 1;

let activeDataverseOrgMap: DataverseOrgMap = { records: {} };

const normalizeDataverseOrgMap = (value: unknown): DataverseOrgMap => {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'records')) {
    return dataverseOrgMapSchema.parse(value);
  }

  return { records: {} };
};

export const getDataverseOrgMap = () => activeDataverseOrgMap;

export const getDataverseOrgRecord = (envId: string): DataverseOrgRecord | null =>
  activeDataverseOrgMap.records[envId] || null;

export const loadDataverseOrgMap = async () => {
  const loaded = await readVersionedStore({
    filePath: getDataFilePath('dataverse-org-map.json'),
    migrate: normalizeDataverseOrgMap,
    name: STORE_NAME,
    parse: normalizeDataverseOrgMap,
    version: STORE_VERSION,
  });

  activeDataverseOrgMap = loaded || { records: {} };
  return activeDataverseOrgMap;
};

export const saveDataverseOrgRecord = async (record: DataverseOrgRecord) => {
  const parsed = dataverseOrgMapSchema.parse({
    records: {
      ...activeDataverseOrgMap.records,
      [record.envId]: record,
    },
  });

  await writeVersionedStore({
    data: parsed,
    filePath: getDataFilePath('dataverse-org-map.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });

  activeDataverseOrgMap = parsed;
  return record;
};
