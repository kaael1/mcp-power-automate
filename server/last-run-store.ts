import { promises as fs } from 'node:fs';

import { makeFlowKey } from './flow-key.js';
import type { LastRun } from './schemas.js';
import { lastRunSchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

let activeKey: string | null = null;
let lastRunsByKey: Record<string, LastRun> = {};

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

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
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getDataFilePath('last-run.json'), 'utf8');
    const normalized = normalizeStoredShape(JSON.parse(raw));
    activeKey = normalized.activeKey;
    lastRunsByKey = normalized.records;
    return getPersistedShape();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      activeKey = null;
      lastRunsByKey = {};
      return null;
    }

    activeKey = null;
    lastRunsByKey = {};
    return null;
  }
};

export const saveLastRun = async (lastRun: LastRun) => {
  const parsed = lastRunSchema.parse(lastRun);
  const key = makeFlowKey(parsed);
  await ensureDataDir();
  lastRunsByKey = {
    ...lastRunsByKey,
    [key]: parsed,
  };
  activeKey = key;
  await fs.writeFile(getDataFilePath('last-run.json'), `${JSON.stringify(getPersistedShape(), null, 2)}\n`, 'utf8');
  return parsed;
};
