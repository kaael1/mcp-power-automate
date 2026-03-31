import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lastRunSchema } from './schemas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const lastRunFilePath = path.join(dataDir, 'last-run.json');

let activeLastRun = null;

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

export const getLastRun = () => activeLastRun;

export const loadLastRun = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(lastRunFilePath, 'utf8');
    activeLastRun = lastRunSchema.parse(JSON.parse(raw));
    return activeLastRun;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeLastRun = null;
      return null;
    }

    activeLastRun = null;
    return null;
  }
};

export const saveLastRun = async (lastRun) => {
  const parsed = lastRunSchema.parse(lastRun);
  await ensureDataDir();
  await fs.writeFile(lastRunFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeLastRun = parsed;
  return parsed;
};
