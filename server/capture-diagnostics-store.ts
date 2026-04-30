import type { CaptureDiagnostic } from './schemas.js';
import { captureDiagnosticSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'capture-diagnostics';
const STORE_VERSION = 1;
const MAX_RECORDS = 100;

type CaptureDiagnosticsState = {
  records: CaptureDiagnostic[];
};

let captureDiagnosticsState: CaptureDiagnosticsState = {
  records: [],
};

const getStoreFilePath = () => getDataFilePath('capture-diagnostics.json');

const normalizeStoredShape = (rawValue: unknown): CaptureDiagnosticsState => {
  const records =
    Array.isArray((rawValue as { records?: unknown[] } | null | undefined)?.records) ?
      (rawValue as { records: unknown[] }).records
    : Array.isArray(rawValue) ? rawValue
    : [];

  return {
    records: records.map((record) => captureDiagnosticSchema.parse(record)),
  };
};

export const getCaptureDiagnostics = () => captureDiagnosticsState.records;

export const getLatestCaptureDiagnostic = () => captureDiagnosticsState.records[0] || null;

export const getLatestCaptureDiagnosticForFlow = ({ envId, flowId }: { envId: string; flowId: string }) =>
  captureDiagnosticsState.records.find((record) => record.envId === envId && record.flowId === flowId) || null;

export const loadCaptureDiagnostics = async () => {
  captureDiagnosticsState =
    (await readVersionedStore({
      filePath: getStoreFilePath(),
      migrate: normalizeStoredShape,
      name: STORE_NAME,
      parse: normalizeStoredShape,
      version: STORE_VERSION,
    })) || { records: [] };

  return captureDiagnosticsState;
};

export const saveCaptureDiagnostic = async (diagnostic: CaptureDiagnostic) => {
  const parsed = captureDiagnosticSchema.parse(diagnostic);
  captureDiagnosticsState = {
    records: [parsed, ...captureDiagnosticsState.records].slice(0, MAX_RECORDS),
  };

  await writeVersionedStore({
    data: captureDiagnosticsState,
    filePath: getStoreFilePath(),
    name: STORE_NAME,
    version: STORE_VERSION,
  });

  return parsed;
};
