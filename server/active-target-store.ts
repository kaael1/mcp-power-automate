import type { ActiveTarget } from './schemas.js';
import { activeTargetSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { markStoreMissing, readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'active-target';
const STORE_VERSION = 1;

let activeTarget: ActiveTarget | null = null;

export const getActiveTarget = () => activeTarget;

export const loadActiveTarget = async () => {
  activeTarget = await readVersionedStore({
    filePath: getDataFilePath('active-target.json'),
    migrate: (value) => activeTargetSchema.parse(value),
    name: STORE_NAME,
    parse: (value) => activeTargetSchema.parse(value),
    version: STORE_VERSION,
  });
  return activeTarget;
};

export const saveActiveTarget = async (target: ActiveTarget) => {
  const parsed = activeTargetSchema.parse(target);
  await writeVersionedStore({
    data: parsed,
    filePath: getDataFilePath('active-target.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  activeTarget = parsed;
  return parsed;
};

export const clearActiveTarget = async () => {
  activeTarget = null;
  await fs.rm(getDataFilePath('active-target.json'), { force: true });
  markStoreMissing(STORE_NAME, getDataFilePath('active-target.json'));
};
import { promises as fs } from 'node:fs';
