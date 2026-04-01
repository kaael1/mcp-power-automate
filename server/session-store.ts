import { promises as fs } from 'node:fs';

import type { Session } from './schemas.js';
import { sessionSchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

let activeSession: Session | null = null;

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

export const getSessionFilePath = () => getDataFilePath('session.json');

export const getSession = () => activeSession;

export const loadSession = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getSessionFilePath(), 'utf8');
    activeSession = sessionSchema.parse(JSON.parse(raw));
    return activeSession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      activeSession = null;
      return null;
    }

    activeSession = null;
    return null;
  }
};

export const saveSession = async (session: Session) => {
  const parsed = sessionSchema.parse(session);
  await ensureDataDir();
  await fs.writeFile(getSessionFilePath(), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeSession = parsed;
  return parsed;
};

export const clearSession = async () => {
  activeSession = null;

  try {
    await fs.unlink(getSessionFilePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }
};
