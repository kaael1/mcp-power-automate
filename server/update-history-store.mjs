import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lastUpdateSchema } from './schemas.mjs';
import { makeFlowKey } from './flow-key.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const historyFilePath = path.join(dataDir, 'last-update.json');

let activeKey = null;
let updatesByKey = {};

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

const normalizeStoredShape = (rawValue) => {
  if (rawValue?.records) {
    return {
      activeKey: rawValue.activeKey || null,
      records: Object.fromEntries(
        Object.entries(rawValue.records).map(([key, value]) => [key, lastUpdateSchema.parse(value)]),
      ),
    };
  }

  if (rawValue) {
    const parsed = lastUpdateSchema.parse(rawValue);
    const key = makeFlowKey(parsed);
    return {
      activeKey: key,
      records: {
        [key]: parsed,
      },
    };
  }

  return {
    activeKey: null,
    records: {},
  };
};

const getPersistedShape = () => ({
  activeKey,
  records: updatesByKey,
});

export const getLastUpdate = () => (activeKey ? updatesByKey[activeKey] || null : null);

export const getLastUpdateForFlow = ({ envId, flowId }) => updatesByKey[makeFlowKey({ envId, flowId })] || null;

export const loadLastUpdate = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(historyFilePath, 'utf8');
    const normalized = normalizeStoredShape(JSON.parse(raw));
    activeKey = normalized.activeKey;
    updatesByKey = normalized.records;
    return getPersistedShape();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeKey = null;
      updatesByKey = {};
      return null;
    }

    activeKey = null;
    updatesByKey = {};
    return null;
  }
};

export const saveLastUpdate = async (lastUpdate) => {
  const parsed = lastUpdateSchema.parse(lastUpdate);
  const key = makeFlowKey(parsed);
  await ensureDataDir();
  updatesByKey = {
    ...updatesByKey,
    [key]: parsed,
  };
  activeKey = key;
  await fs.writeFile(historyFilePath, `${JSON.stringify(getPersistedShape(), null, 2)}\n`, 'utf8');
  return parsed;
};
