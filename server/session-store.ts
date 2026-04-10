import type { Session } from './schemas.js';
import { sessionSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { markStoreMissing, readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'session';
const STORE_VERSION = 1;

let activeSession: Session | null = null;

export const getSessionFilePath = () => getDataFilePath('session.json');

export const getSession = () => activeSession;

export const loadSession = async () => {
  activeSession = await readVersionedStore({
    filePath: getSessionFilePath(),
    migrate: (value) => sessionSchema.parse(value),
    name: STORE_NAME,
    parse: (value) => sessionSchema.parse(value),
    version: STORE_VERSION,
  });
  return activeSession;
};

export const saveSession = async (session: Session) => {
  const sameEnvironment = activeSession?.envId === session.envId;
  const parsed = sessionSchema.parse({
    ...session,
    legacyApiUrl: session.legacyApiUrl ?? (sameEnvironment ? activeSession?.legacyApiUrl : undefined),
    legacyToken: session.legacyToken ?? (sameEnvironment ? activeSession?.legacyToken : undefined),
  });
  await writeVersionedStore({
    data: parsed,
    filePath: getSessionFilePath(),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  activeSession = parsed;
  return parsed;
};

export const clearSession = async () => {
  activeSession = null;
  await fs.rm(getSessionFilePath(), { force: true });
  markStoreMissing(STORE_NAME, getSessionFilePath());
};
import { promises as fs } from 'node:fs';
