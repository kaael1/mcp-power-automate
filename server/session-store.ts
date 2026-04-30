import { promises as fs } from 'node:fs';

import type { CapturedSession, Session } from './schemas.js';
import { sessionSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { upsertCapturedSession, getCapturedSession, listCapturedSessions, loadCapturedSessions } from './captured-sessions-store.js';
import { clearSelectedWorkTab, getSelectedWorkTab, loadSelectedWorkTab, saveSelectedWorkTab } from './selected-work-tab-store.js';
import { markStoreMissing, readVersionedStore, writeVersionedStore } from './store-utils.js';

const LEGACY_STORE_NAME = 'session';
const LEGACY_STORE_VERSION = 1;
const LEGACY_TAB_ID = 0;

let activeSession: Session | null = null;

const getLegacySessionFilePath = () => getDataFilePath('session.json');

const toSession = (capturedSession: CapturedSession | null): Session | null => {
  if (!capturedSession) return null;

  return sessionSchema.parse({
    apiToken: capturedSession.apiToken,
    apiUrl: capturedSession.apiUrl,
    capturedAt: capturedSession.capturedAt,
    envId: capturedSession.envId,
    flowId: capturedSession.flowId,
    legacyApiUrl: capturedSession.legacyApiUrl,
    legacyToken: capturedSession.legacyToken,
    portalUrl: capturedSession.portalUrl,
  });
};

const syncLegacyMirror = async (session: Session | null) => {
  if (!session) {
    await fs.rm(getLegacySessionFilePath(), { force: true });
    markStoreMissing(LEGACY_STORE_NAME, getLegacySessionFilePath());
    return null;
  }

  await writeVersionedStore({
    data: session,
    filePath: getLegacySessionFilePath(),
    name: LEGACY_STORE_NAME,
    version: LEGACY_STORE_VERSION,
  });

  return session;
};

const hydrateActiveSession = async () => {
  const selectedWorkTab = getSelectedWorkTab();
  const selectedCapturedSession = selectedWorkTab ? getCapturedSession(selectedWorkTab.tabId) : null;
  const fallbackCapturedSession = listCapturedSessions()[0] || null;

  activeSession = toSession(selectedCapturedSession || fallbackCapturedSession);
  if (activeSession) {
    await syncLegacyMirror(activeSession);
  }
  return activeSession;
};

const migrateLegacySessionIfNeeded = async () => {
  if (listCapturedSessions().length > 0) {
    return null;
  }

  const legacySession = await readVersionedStore({
    filePath: getLegacySessionFilePath(),
    migrate: (value) => sessionSchema.parse(value),
    name: LEGACY_STORE_NAME,
    parse: (value) => sessionSchema.parse(value),
    version: LEGACY_STORE_VERSION,
  });

  if (!legacySession) {
    return null;
  }

  const migratedSession = await upsertCapturedSession({
    ...legacySession,
    lastSeenAt: legacySession.capturedAt,
    tabId: LEGACY_TAB_ID,
  });

  await saveSelectedWorkTab({
    selectedAt: legacySession.capturedAt,
    tabId: migratedSession.tabId,
  });

  return legacySession;
};

export const getSessionFilePath = () => getLegacySessionFilePath();

export const getSession = () => {
  const selectedWorkTab = getSelectedWorkTab();
  const selectedCapturedSession = selectedWorkTab ? getCapturedSession(selectedWorkTab.tabId) : null;
  const fallbackCapturedSession = listCapturedSessions()[0] || null;
  activeSession = toSession(selectedCapturedSession || fallbackCapturedSession);
  return activeSession;
};

export const getSelectedWorkSession = () => getSession();

export const loadSession = async () => {
  await loadCapturedSessions();
  await loadSelectedWorkTab();
  await migrateLegacySessionIfNeeded();
  return hydrateActiveSession();
};

export const saveSession = async (session: Session & { tabId?: number }) => {
  const currentSession = getSession();
  const sameEnvironment = currentSession?.envId === session.envId;
  const parsed = sessionSchema.parse({
    ...session,
    legacyApiUrl: session.legacyApiUrl ?? (sameEnvironment ? currentSession?.legacyApiUrl : undefined),
    legacyToken: session.legacyToken ?? (sameEnvironment ? currentSession?.legacyToken : undefined),
  });

  const tabId = typeof session.tabId === 'number' ? session.tabId : LEGACY_TAB_ID;
  await upsertCapturedSession({
    ...parsed,
    lastSeenAt: parsed.capturedAt,
    tabId,
  });
  await saveSelectedWorkTab({
    selectedAt: new Date().toISOString(),
    tabId,
  });

  activeSession = parsed;
  await syncLegacyMirror(activeSession);
  return parsed;
};

export const clearSession = async () => {
  activeSession = null;
  await clearSelectedWorkTab();
  await syncLegacyMirror(null);
};
