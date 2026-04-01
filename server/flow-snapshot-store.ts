import { promises as fs } from 'node:fs';

import { makeFlowKey } from './flow-key.js';
import type { FlowSnapshot } from './schemas.js';
import { flowSnapshotSchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

let activeKey: string | null = null;
let snapshotsByKey: Record<string, FlowSnapshot> = {};

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

const normalizeStoredShape = (rawValue: unknown) => {
  const recordsSource = (rawValue as { records?: Record<string, unknown> } | null | undefined)?.records;

  if (recordsSource) {
    return {
      activeKey: (rawValue as { activeKey?: string | null }).activeKey || null,
      records: Object.fromEntries(
        Object.entries(recordsSource).map(([key, value]) => [key, flowSnapshotSchema.parse(value)]),
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

export const getFlowSnapshotForFlow = ({ envId, flowId }: { envId: string; flowId: string }) =>
  snapshotsByKey[makeFlowKey({ envId, flowId })] || null;

export const loadFlowSnapshot = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getDataFilePath('flow-snapshot.json'), 'utf8');
    const normalized = normalizeStoredShape(JSON.parse(raw));
    activeKey = normalized.activeKey;
    snapshotsByKey = normalized.records;
    return getPersistedShape();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      activeKey = null;
      snapshotsByKey = {};
      return null;
    }

    activeKey = null;
    snapshotsByKey = {};
    return null;
  }
};

export const saveFlowSnapshot = async (snapshot: FlowSnapshot) => {
  const parsed = flowSnapshotSchema.parse(snapshot);
  const key = makeFlowKey(parsed);
  await ensureDataDir();
  snapshotsByKey = {
    ...snapshotsByKey,
    [key]: parsed,
  };
  activeKey = key;
  await fs.writeFile(getDataFilePath('flow-snapshot.json'), `${JSON.stringify(getPersistedShape(), null, 2)}\n`, 'utf8');
  return parsed;
};
