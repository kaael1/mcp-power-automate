import { promises as fs } from 'node:fs';

import type { ActiveTarget } from './schemas.js';
import { activeTargetSchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

let activeTarget: ActiveTarget | null = null;

export const getActiveTarget = () => activeTarget;

export const loadActiveTarget = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getDataFilePath('active-target.json'), 'utf8');
    activeTarget = activeTargetSchema.parse(JSON.parse(raw));
    return activeTarget;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      activeTarget = null;
      return null;
    }

    activeTarget = null;
    return null;
  }
};

export const saveActiveTarget = async (target: ActiveTarget) => {
  const parsed = activeTargetSchema.parse(target);
  await ensureDataDir();
  await fs.writeFile(getDataFilePath('active-target.json'), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeTarget = parsed;
  return parsed;
};

export const clearActiveTarget = async () => {
  activeTarget = null;

  try {
    await fs.unlink(getDataFilePath('active-target.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }
};
