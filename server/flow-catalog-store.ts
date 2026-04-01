import { promises as fs } from 'node:fs';

import type { FlowCatalog } from './schemas.js';
import { flowCatalogSchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

let flowCatalog: FlowCatalog | null = null;

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

export const getFlowCatalog = () => flowCatalog;

export const getFlowCatalogForEnv = (envId: string) => {
  if (!flowCatalog || flowCatalog.envId !== envId) return null;
  return flowCatalog;
};

export const loadFlowCatalog = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getDataFilePath('flow-catalog.json'), 'utf8');
    flowCatalog = flowCatalogSchema.parse(JSON.parse(raw));
    return flowCatalog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      flowCatalog = null;
      return null;
    }

    flowCatalog = null;
    return null;
  }
};

export const saveFlowCatalog = async (catalog: FlowCatalog) => {
  const parsed = flowCatalogSchema.parse(catalog);
  await ensureDataDir();
  await fs.writeFile(getDataFilePath('flow-catalog.json'), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  flowCatalog = parsed;
  return parsed;
};
