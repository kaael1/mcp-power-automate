import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessionSchema } from './schemas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const sessionFilePath = path.join(dataDir, 'session.json');

let activeSession = null;

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

export const getSessionFilePath = () => sessionFilePath;

export const getSession = () => activeSession;

export const loadSession = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(sessionFilePath, 'utf8');
    activeSession = sessionSchema.parse(JSON.parse(raw));
    return activeSession;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeSession = null;
      return null;
    }

    activeSession = null;
    return null;
  }
};

export const saveSession = async (session) => {
  const parsed = sessionSchema.parse(session);
  await ensureDataDir();
  await fs.writeFile(sessionFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeSession = parsed;
  return parsed;
};

export const clearSession = async () => {
  activeSession = null;

  try {
    await fs.unlink(sessionFilePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
};
