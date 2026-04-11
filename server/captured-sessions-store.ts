import { promises as fs } from 'node:fs';

import type { CapturedSession } from './schemas.js';
import { capturedSessionSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { markStoreMissing, readVersionedStore, readVersionedStoreSync, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'captured-sessions';
const STORE_VERSION = 1;

type CapturedSessionsState = {
  records: Record<string, CapturedSession>;
};

let capturedSessionsState: CapturedSessionsState = {
  records: {},
};

const normalizeStoredShape = (rawValue: unknown): CapturedSessionsState => {
  const recordsSource = (rawValue as { records?: Record<string, unknown> } | null | undefined)?.records;

  if (recordsSource) {
    return {
      records: Object.fromEntries(
        Object.entries(recordsSource).map(([key, value]) => [key, capturedSessionSchema.parse(value)]),
      ),
    };
  }

  if (rawValue) {
    const parsed = capturedSessionSchema.parse(rawValue);
    return {
      records: {
        [String(parsed.tabId)]: parsed,
      },
    };
  }

  return {
    records: {},
  };
};

const getStoreFilePath = () => getDataFilePath('captured-sessions.json');

const refreshCapturedSessionsState = () => {
  const nextState = readVersionedStoreSync({
    filePath: getStoreFilePath(),
    migrate: normalizeStoredShape,
    name: STORE_NAME,
    parse: normalizeStoredShape,
    version: STORE_VERSION,
  });

  if (!nextState) {
    capturedSessionsState = { records: {} };
    return capturedSessionsState;
  }

  capturedSessionsState = nextState;
  return capturedSessionsState;
};

export const loadCapturedSessions = async () => {
  const nextState = await readVersionedStore({
    filePath: getStoreFilePath(),
    migrate: normalizeStoredShape,
    name: STORE_NAME,
    parse: normalizeStoredShape,
    version: STORE_VERSION,
  });

  capturedSessionsState = nextState || { records: {} };
  return capturedSessionsState;
};

export const listCapturedSessions = () =>
  Object.values(refreshCapturedSessionsState().records).sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));

export const getCapturedSession = (tabId: number | null | undefined) => {
  if (typeof tabId !== 'number') return null;
  return refreshCapturedSessionsState().records[String(tabId)] || null;
};

export const upsertCapturedSession = async (session: CapturedSession) => {
  const parsed = capturedSessionSchema.parse(session);
  const nextState = refreshCapturedSessionsState();

  capturedSessionsState = {
    records: {
      ...nextState.records,
      [String(parsed.tabId)]: parsed,
    },
  };

  await writeVersionedStore({
    data: capturedSessionsState,
    filePath: getStoreFilePath(),
    name: STORE_NAME,
    version: STORE_VERSION,
  });

  return parsed;
};

export const removeCapturedSession = async (tabId: number) => {
  const nextState = refreshCapturedSessionsState();
  const nextRecords = { ...nextState.records };
  delete nextRecords[String(tabId)];
  capturedSessionsState = {
    records: nextRecords,
  };

  if (Object.keys(nextRecords).length === 0) {
    await fs.rm(getStoreFilePath(), { force: true });
    markStoreMissing(STORE_NAME, getStoreFilePath());
    return null;
  }

  await writeVersionedStore({
    data: capturedSessionsState,
    filePath: getStoreFilePath(),
    name: STORE_NAME,
    version: STORE_VERSION,
  });

  return capturedSessionsState;
};
