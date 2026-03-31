import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flowCatalogSchema } from './schemas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const catalogFilePath = path.join(dataDir, 'flow-catalog.json');

let flowCatalog = null;

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

export const getFlowCatalog = () => flowCatalog;

export const getFlowCatalogForEnv = (envId) => {
  if (!flowCatalog || flowCatalog.envId !== envId) return null;
  return flowCatalog;
};

export const loadFlowCatalog = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(catalogFilePath, 'utf8');
    flowCatalog = flowCatalogSchema.parse(JSON.parse(raw));
    return flowCatalog;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      flowCatalog = null;
      return null;
    }

    flowCatalog = null;
    return null;
  }
};

export const saveFlowCatalog = async (catalog) => {
  const parsed = flowCatalogSchema.parse(catalog);
  await ensureDataDir();
  await fs.writeFile(catalogFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  flowCatalog = parsed;
  return parsed;
};
