import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resolvePackageRoot = (startDir: string) => {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not find package.json while resolving runtime paths from ${startDir}.`);
    }

    currentDir = parentDir;
  }
};

export const getPackageRoot = () => resolvePackageRoot(path.dirname(fileURLToPath(import.meta.url)));

export const getDataDir = () => {
  if (process.env.POWER_AUTOMATE_DATA_DIR) {
    return path.resolve(process.env.POWER_AUTOMATE_DATA_DIR);
  }

  return path.join(getPackageRoot(), 'data');
};

export const getDataFilePath = (fileName: string) => path.join(getDataDir(), fileName);
