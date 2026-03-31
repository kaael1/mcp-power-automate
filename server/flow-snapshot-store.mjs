import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flowSnapshotSchema } from './schemas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const snapshotFilePath = path.join(dataDir, 'flow-snapshot.json');

let activeSnapshot = null;

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

export const getFlowSnapshot = () => activeSnapshot;

export const loadFlowSnapshot = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(snapshotFilePath, 'utf8');
    activeSnapshot = flowSnapshotSchema.parse(JSON.parse(raw));
    return activeSnapshot;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeSnapshot = null;
      return null;
    }

    activeSnapshot = null;
    return null;
  }
};

export const saveFlowSnapshot = async (snapshot) => {
  const parsed = flowSnapshotSchema.parse(snapshot);
  await ensureDataDir();
  await fs.writeFile(snapshotFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeSnapshot = parsed;
  return parsed;
};
