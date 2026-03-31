import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lastUpdateSchema } from './schemas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const historyFilePath = path.join(dataDir, 'last-update.json');

let activeLastUpdate = null;

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

export const getLastUpdate = () => activeLastUpdate;

export const loadLastUpdate = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(historyFilePath, 'utf8');
    activeLastUpdate = lastUpdateSchema.parse(JSON.parse(raw));
    return activeLastUpdate;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeLastUpdate = null;
      return null;
    }

    activeLastUpdate = null;
    return null;
  }
};

export const saveLastUpdate = async (lastUpdate) => {
  const parsed = lastUpdateSchema.parse(lastUpdate);
  await ensureDataDir();
  await fs.writeFile(historyFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeLastUpdate = parsed;
  return parsed;
};
