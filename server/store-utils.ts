import { promises as fs } from 'node:fs';
import path from 'node:path';

export type StoreState = 'corrupted' | 'migrated' | 'missing' | 'ok';

export interface StoreDiagnostic {
  filePath: string;
  loadedAt: string;
  message: string | null;
  name: string;
  state: StoreState;
  version: number | null;
}

interface VersionedStoreEnvelope<T> {
  data: T;
  version: number;
}

const storeDiagnostics = new Map<string, StoreDiagnostic>();

const isVersionedStoreEnvelope = <T>(value: unknown): value is VersionedStoreEnvelope<T> =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as { version?: unknown }).version === 'number' &&
  Object.prototype.hasOwnProperty.call(value, 'data');

const setStoreDiagnostic = ({
  filePath,
  message = null,
  name,
  state,
  version = null,
}: {
  filePath: string;
  message?: string | null;
  name: string;
  state: StoreState;
  version?: number | null;
}) => {
  storeDiagnostics.set(name, {
    filePath,
    loadedAt: new Date().toISOString(),
    message,
    name,
    state,
    version,
  });
};

const ensureDirectoryFor = async (filePath: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const replaceFileAtomically = async (filePath: string, contents: string) => {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, contents, 'utf8');

  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST' && (error as NodeJS.ErrnoException)?.code !== 'EPERM') {
      throw error;
    }

    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath);
  }
};

export const getStoreDiagnostics = () =>
  [...storeDiagnostics.values()].sort((left, right) => left.name.localeCompare(right.name));

export const markStoreMissing = (name: string, filePath: string) => {
  setStoreDiagnostic({
    filePath,
    name,
    state: 'missing',
  });
};

export const readVersionedStore = async <T>({
  filePath,
  migrate,
  name,
  parse,
  version,
}: {
  filePath: string;
  migrate: (value: unknown) => T;
  name: string;
  parse: (value: unknown) => T;
  version: number;
}) => {
  await ensureDirectoryFor(filePath);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsedJson = JSON.parse(raw) as unknown;

    if (isVersionedStoreEnvelope(parsedJson) && parsedJson.version === version) {
      const parsedValue = parse(parsedJson.data);
      setStoreDiagnostic({
        filePath,
        name,
        state: 'ok',
        version,
      });
      return parsedValue;
    }

    const migratedValue = parse(migrate(parsedJson));
    setStoreDiagnostic({
      filePath,
      name,
      state: 'migrated',
      version: isVersionedStoreEnvelope(parsedJson) ? parsedJson.version : null,
    });
    return migratedValue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      markStoreMissing(name, filePath);
      return null;
    }

    setStoreDiagnostic({
      filePath,
      message: error instanceof Error ? error.message : String(error),
      name,
      state: 'corrupted',
      version: null,
    });
    return null;
  }
};

export const writeVersionedStore = async <T>({
  data,
  filePath,
  name,
  version,
}: {
  data: T;
  filePath: string;
  name: string;
  version: number;
}) => {
  await ensureDirectoryFor(filePath);
  await replaceFileAtomically(
    filePath,
    `${JSON.stringify(
      {
        data,
        version,
      },
      null,
      2,
    )}\n`,
  );
  setStoreDiagnostic({
    filePath,
    name,
    state: 'ok',
    version,
  });
  return data;
};
