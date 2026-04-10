import { createFlowReview } from './client-helpers.js';
import { makeFlowKey } from './flow-key.js';
import type { LastUpdate } from './schemas.js';
import { lastUpdateSchema, normalizedFlowSchema, updateSummarySchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'last-update';
const STORE_VERSION = 1;

let activeKey: string | null = null;
let updatesByKey: Record<string, LastUpdate> = {};

const normalizeStoredShape = (rawValue: unknown) => {
  const upgradeLegacyLastUpdate = (value: unknown) => {
    const parsed = value as
      | {
          after?: unknown;
          before?: unknown;
          capturedAt?: string;
          envId?: string;
          flowId?: string;
          review?: unknown;
          summary?: unknown;
        }
      | null
      | undefined;

    const before = normalizedFlowSchema.parse(parsed?.before);
    const after = normalizedFlowSchema.parse(parsed?.after);

    return lastUpdateSchema.parse({
      after,
      before,
      capturedAt: parsed?.capturedAt,
      envId: parsed?.envId,
      flowId: parsed?.flowId,
      review: parsed?.review ?? createFlowReview({ after, before }),
      summary: updateSummarySchema.parse(parsed?.summary),
    });
  };

  const recordsSource = (rawValue as { records?: Record<string, unknown> } | null | undefined)?.records;

  if (recordsSource) {
    return {
      activeKey: (rawValue as { activeKey?: string | null }).activeKey || null,
      records: Object.fromEntries(
        Object.entries(recordsSource).map(([key, value]) => [key, upgradeLegacyLastUpdate(value)]),
      ),
    };
  }

  if (rawValue) {
    const parsed = upgradeLegacyLastUpdate(rawValue);
    const key = makeFlowKey(parsed);
    return {
      activeKey: key,
      records: {
        [key]: parsed,
      },
    };
  }

  return {
    activeKey: null,
    records: {},
  };
};

const getPersistedShape = () => ({
  activeKey,
  records: updatesByKey,
});

export const getLastUpdate = () => (activeKey ? updatesByKey[activeKey] || null : null);

export const getLastUpdateForFlow = ({ envId, flowId }: { envId: string; flowId: string }) =>
  updatesByKey[makeFlowKey({ envId, flowId })] || null;

export const loadLastUpdate = async () => {
  const normalized = await readVersionedStore({
    filePath: getDataFilePath('last-update.json'),
    migrate: normalizeStoredShape,
    name: STORE_NAME,
    parse: normalizeStoredShape,
    version: STORE_VERSION,
  });

  if (!normalized) {
    activeKey = null;
    updatesByKey = {};
    return null;
  }

  activeKey = normalized.activeKey;
  updatesByKey = normalized.records;
  return getPersistedShape();
};

export const saveLastUpdate = async (lastUpdate: LastUpdate) => {
  const parsed = lastUpdateSchema.parse(lastUpdate);
  const key = makeFlowKey(parsed);
  updatesByKey = {
    ...updatesByKey,
    [key]: parsed,
  };
  activeKey = key;
  await writeVersionedStore({
    data: getPersistedShape(),
    filePath: getDataFilePath('last-update.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  return parsed;
};
