import { makeFlowKey } from './flow-key.js';
import type { FlowSnapshot } from './schemas.js';
import { flowSnapshotSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'flow-snapshot';
const STORE_VERSION = 1;

let activeKey: string | null = null;
let snapshotsByKey: Record<string, FlowSnapshot> = {};

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
  const normalized = await readVersionedStore({
    filePath: getDataFilePath('flow-snapshot.json'),
    migrate: normalizeStoredShape,
    name: STORE_NAME,
    parse: normalizeStoredShape,
    version: STORE_VERSION,
  });

  if (!normalized) {
    activeKey = null;
    snapshotsByKey = {};
    return null;
  }

  activeKey = normalized.activeKey;
  snapshotsByKey = normalized.records;
  return getPersistedShape();
};

export const saveFlowSnapshot = async (snapshot: FlowSnapshot) => {
  const parsed = flowSnapshotSchema.parse(snapshot);
  const key = makeFlowKey(parsed);
  snapshotsByKey = {
    ...snapshotsByKey,
    [key]: parsed,
  };
  activeKey = key;
  await writeVersionedStore({
    data: getPersistedShape(),
    filePath: getDataFilePath('flow-snapshot.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  return parsed;
};
