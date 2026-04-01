import { promises as fs } from 'node:fs';

import { makeFlowKey } from './flow-key.js';
import type { LastUpdate } from './schemas.js';
import { lastUpdateSchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

let activeKey: string | null = null;
let updatesByKey: Record<string, LastUpdate> = {};

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

const normalizeStoredShape = (rawValue: unknown) => {
  const recordsSource = (rawValue as { records?: Record<string, unknown> } | null | undefined)?.records;

  if (recordsSource) {
    return {
      activeKey: (rawValue as { activeKey?: string | null }).activeKey || null,
      records: Object.fromEntries(
        Object.entries(recordsSource).map(([key, value]) => [key, lastUpdateSchema.parse(value)]),
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

export const getLastUpdateForFlow = ({ envId, flowId }: { envId: string; flowId: string }) =>
  updatesByKey[makeFlowKey({ envId, flowId })] || null;

export const loadLastUpdate = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getDataFilePath('last-update.json'), 'utf8');
    const normalized = normalizeStoredShape(JSON.parse(raw));
    activeKey = normalized.activeKey;
    updatesByKey = normalized.records;
    return getPersistedShape();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      activeKey = null;
      updatesByKey = {};
      return null;
    }

    activeKey = null;
    updatesByKey = {};
    return null;
  }
};

export const saveLastUpdate = async (lastUpdate: LastUpdate) => {
  const parsed = lastUpdateSchema.parse(lastUpdate);
  const key = makeFlowKey(parsed);
  await ensureDataDir();
  updatesByKey = {
    ...updatesByKey,
    [key]: parsed,
  };
  activeKey = key;
  await fs.writeFile(getDataFilePath('last-update.json'), `${JSON.stringify(getPersistedShape(), null, 2)}\n`, 'utf8');
  return parsed;
};
