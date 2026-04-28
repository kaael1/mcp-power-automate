import type { DataverseOrgMap, DataverseOrgRecord } from './schemas.js';
import { dataverseOrgMapSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'dataverse-org-map';
const STORE_VERSION = 1;

let activeMap: DataverseOrgMap = { records: {} };

const normalizeShape = (rawValue: unknown): DataverseOrgMap => {
  if (rawValue && typeof rawValue === 'object' && 'records' in rawValue) {
    return dataverseOrgMapSchema.parse(rawValue);
  }
  return { records: {} };
};

export const getDataverseOrgMap = () => activeMap;

export const getDataverseOrgRecord = (envId: string): DataverseOrgRecord | null => activeMap.records[envId] || null;

export const loadDataverseOrgMap = async () => {
  const loaded = await readVersionedStore({
    filePath: getDataFilePath('dataverse-org-map.json'),
    migrate: normalizeShape,
    name: STORE_NAME,
    parse: normalizeShape,
    version: STORE_VERSION,
  });

  activeMap = loaded || { records: {} };
  return activeMap;
};

export const saveDataverseOrgRecord = async (record: DataverseOrgRecord) => {
  const next: DataverseOrgMap = {
    records: {
      ...activeMap.records,
      [record.envId]: record,
    },
  };
  const parsed = dataverseOrgMapSchema.parse(next);
  await writeVersionedStore({
    data: parsed,
    filePath: getDataFilePath('dataverse-org-map.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  activeMap = parsed;
  return record;
};
