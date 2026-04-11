import { promises as fs } from 'node:fs';

import type { ActiveTarget } from './schemas.js';
import { activeTargetSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { markStoreMissing, readVersionedStore, readVersionedStoreSync, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'active-target';
const STORE_VERSION = 1;

type ActiveTargetsState = {
  records: Record<string, ActiveTarget>;
};

let activeTargetsState: ActiveTargetsState = {
  records: {},
};

const getStoreFilePath = () => getDataFilePath('active-target.json');

const normalizeStoredShape = (rawValue: unknown): ActiveTargetsState => {
  const recordsSource = (rawValue as { records?: Record<string, unknown> } | null | undefined)?.records;

  if (recordsSource) {
    return {
      records: Object.fromEntries(
        Object.entries(recordsSource).map(([key, value]) => [key, activeTargetSchema.parse(value)]),
      ),
    };
  }

  if (rawValue) {
    const parsed = activeTargetSchema.parse(rawValue);
    return {
      records: {
        [parsed.envId]: parsed,
      },
    };
  }

  return {
    records: {},
  };
};

const refreshActiveTargetsState = () => {
  const nextState = readVersionedStoreSync({
    filePath: getStoreFilePath(),
    migrate: normalizeStoredShape,
    name: STORE_NAME,
    parse: normalizeStoredShape,
    version: STORE_VERSION,
  });

  activeTargetsState = nextState || { records: {} };
  return activeTargetsState;
};

export const getActiveTarget = (envId?: string | null) => {
  const state = refreshActiveTargetsState();

  if (envId) {
    return state.records[envId] || null;
  }

  return Object.values(state.records)[0] || null;
};

export const loadActiveTarget = async () => {
  activeTargetsState =
    (await readVersionedStore({
      filePath: getStoreFilePath(),
      migrate: normalizeStoredShape,
      name: STORE_NAME,
      parse: normalizeStoredShape,
      version: STORE_VERSION,
    })) || { records: {} };
  return activeTargetsState;
};

export const saveActiveTarget = async (target: ActiveTarget) => {
  const parsed = activeTargetSchema.parse(target);
  const nextState = refreshActiveTargetsState();

  activeTargetsState = {
    records: {
      ...nextState.records,
      [parsed.envId]: parsed,
    },
  };

  await writeVersionedStore({
    data: activeTargetsState,
    filePath: getStoreFilePath(),
    name: STORE_NAME,
    version: STORE_VERSION,
  });

  return parsed;
};

export const clearActiveTarget = async (envId?: string | null) => {
  if (!envId) {
    activeTargetsState = { records: {} };
    await fs.rm(getStoreFilePath(), { force: true });
    markStoreMissing(STORE_NAME, getStoreFilePath());
    return;
  }

  const nextState = refreshActiveTargetsState();
  const nextRecords = { ...nextState.records };
  delete nextRecords[envId];
  activeTargetsState = {
    records: nextRecords,
  };

  if (Object.keys(nextRecords).length === 0) {
    await fs.rm(getStoreFilePath(), { force: true });
    markStoreMissing(STORE_NAME, getStoreFilePath());
    return;
  }

  await writeVersionedStore({
    data: activeTargetsState,
    filePath: getStoreFilePath(),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
};
