import { makeFlowKey } from './flow-key.js';
import type { LastRun } from './schemas.js';
import { lastRunSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'last-run';
const STORE_VERSION = 1;

let activeKey: string | null = null;
let lastRunsByKey: Record<string, LastRun> = {};

const normalizeStoredShape = (rawValue: unknown) => {
  const recordsSource = (rawValue as { records?: Record<string, unknown> } | null | undefined)?.records;

  if (recordsSource) {
    return {
      activeKey: (rawValue as { activeKey?: string | null }).activeKey || null,
      records: Object.fromEntries(
        Object.entries(recordsSource).map(([key, value]) => [key, lastRunSchema.parse(value)]),
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

export const getLastRunForFlow = ({ envId, flowId }: { envId: string; flowId: string }) =>
  lastRunsByKey[makeFlowKey({ envId, flowId })] || null;

export const loadLastRun = async () => {
  const normalized = await readVersionedStore({
    filePath: getDataFilePath('last-run.json'),
    migrate: normalizeStoredShape,
    name: STORE_NAME,
    parse: normalizeStoredShape,
    version: STORE_VERSION,
  });

  if (!normalized) {
    activeKey = null;
    lastRunsByKey = {};
    return null;
  }

  activeKey = normalized.activeKey;
  lastRunsByKey = normalized.records;
  return getPersistedShape();
};

export const saveLastRun = async (lastRun: LastRun) => {
  const parsed = lastRunSchema.parse(lastRun);
  const key = makeFlowKey(parsed);
  lastRunsByKey = {
    ...lastRunsByKey,
    [key]: parsed,
  };
  activeKey = key;
  await writeVersionedStore({
    data: getPersistedShape(),
    filePath: getDataFilePath('last-run.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  return parsed;
};
