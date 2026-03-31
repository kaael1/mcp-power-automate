import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { activeTargetSchema } from './schemas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const activeTargetFilePath = path.join(dataDir, 'active-target.json');

let activeTarget = null;

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

export const getActiveTarget = () => activeTarget;

export const loadActiveTarget = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(activeTargetFilePath, 'utf8');
    activeTarget = activeTargetSchema.parse(JSON.parse(raw));
    return activeTarget;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeTarget = null;
      return null;
    }

    activeTarget = null;
    return null;
  }
};

export const saveActiveTarget = async (target) => {
  const parsed = activeTargetSchema.parse(target);
  await ensureDataDir();
  await fs.writeFile(activeTargetFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeTarget = parsed;
  return parsed;
};

export const clearActiveTarget = async () => {
  activeTarget = null;

  try {
    await fs.unlink(activeTargetFilePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
};
