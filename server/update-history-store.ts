import { promises as fs } from 'node:fs';

import { createFlowReview } from './client-helpers.js';
import { makeFlowKey } from './flow-key.js';
import type { LastUpdate } from './schemas.js';
import { lastUpdateSchema, normalizedFlowSchema, updateSummarySchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

let activeKey: string | null = null;
let updatesByKey: Record<string, LastUpdate> = {};

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

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
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getDataFilePath('last-update.json'), 'utf8');
    const normalized = normalizeStoredShape(JSON.parse(raw));
    activeKey = normalized.activeKey;
    updatesByKey = normalized.records;
    return getPersistedShape();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      activeKey = null;
      updatesByKey = {};
      return null;
    }

    activeKey = null;
    updatesByKey = {};
    return null;
  }
};

export const saveLastUpdate = async (lastUpdate: LastUpdate) => {
  const parsed = lastUpdateSchema.parse(lastUpdate);
  const key = makeFlowKey(parsed);
  await ensureDataDir();
  updatesByKey = {
    ...updatesByKey,
    [key]: parsed,
  };
  activeKey = key;
  await fs.writeFile(getDataFilePath('last-update.json'), `${JSON.stringify(getPersistedShape(), null, 2)}\n`, 'utf8');
  return parsed;
};
