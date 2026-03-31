import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flowSnapshotSchema } from './schemas.mjs';
import { makeFlowKey } from './flow-key.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const snapshotFilePath = path.join(dataDir, 'flow-snapshot.json');

let activeKey = null;
let snapshotsByKey = {};

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

const normalizeStoredShape = (rawValue) => {
  if (rawValue?.records) {
    return {
      activeKey: rawValue.activeKey || null,
      records: Object.fromEntries(
        Object.entries(rawValue.records).map(([key, value]) => [key, flowSnapshotSchema.parse(value)]),
      ),
    };
  }

  if (rawValue) {
    const parsed = flowSnapshotSchema.parse(rawValue);
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
  records: snapshotsByKey,
});

export const getFlowSnapshot = () => (activeKey ? snapshotsByKey[activeKey] || null : null);

export const getFlowSnapshotForFlow = ({ envId, flowId }) => snapshotsByKey[makeFlowKey({ envId, flowId })] || null;

export const loadFlowSnapshot = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(snapshotFilePath, 'utf8');
    const normalized = normalizeStoredShape(JSON.parse(raw));
    activeKey = normalized.activeKey;
    snapshotsByKey = normalized.records;
    return getPersistedShape();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeKey = null;
      snapshotsByKey = {};
      return null;
    }

    activeKey = null;
    snapshotsByKey = {};
    return null;
  }
};

export const saveFlowSnapshot = async (snapshot) => {
  const parsed = flowSnapshotSchema.parse(snapshot);
  const key = makeFlowKey(parsed);
  await ensureDataDir();
  snapshotsByKey = {
    ...snapshotsByKey,
    [key]: parsed,
  };
  activeKey = key;
  await fs.writeFile(snapshotFilePath, `${JSON.stringify(getPersistedShape(), null, 2)}\n`, 'utf8');
  return parsed;
};
