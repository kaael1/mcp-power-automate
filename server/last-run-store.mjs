import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lastRunSchema } from './schemas.mjs';
import { makeFlowKey } from './flow-key.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const lastRunFilePath = path.join(dataDir, 'last-run.json');

let activeKey = null;
let lastRunsByKey = {};

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

const normalizeStoredShape = (rawValue) => {
  if (rawValue?.records) {
    return {
      activeKey: rawValue.activeKey || null,
      records: Object.fromEntries(
        Object.entries(rawValue.records).map(([key, value]) => [key, lastRunSchema.parse(value)]),
      ),
    };
  }

  if (rawValue) {
    const parsed = lastRunSchema.parse(rawValue);
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
  records: lastRunsByKey,
});

export const getLastRun = () => (activeKey ? lastRunsByKey[activeKey] || null : null);

export const getLastRunForFlow = ({ envId, flowId }) => lastRunsByKey[makeFlowKey({ envId, flowId })] || null;

export const loadLastRun = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(lastRunFilePath, 'utf8');
    const normalized = normalizeStoredShape(JSON.parse(raw));
    activeKey = normalized.activeKey;
    lastRunsByKey = normalized.records;
    return getPersistedShape();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeKey = null;
      lastRunsByKey = {};
      return null;
    }

    activeKey = null;
    lastRunsByKey = {};
    return null;
  }
};

export const saveLastRun = async (lastRun) => {
  const parsed = lastRunSchema.parse(lastRun);
  const key = makeFlowKey(parsed);
  await ensureDataDir();
  lastRunsByKey = {
    ...lastRunsByKey,
    [key]: parsed,
  };
  activeKey = key;
  await fs.writeFile(lastRunFilePath, `${JSON.stringify(getPersistedShape(), null, 2)}\n`, 'utf8');
  return parsed;
};
