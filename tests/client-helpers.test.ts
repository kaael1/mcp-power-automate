import { describe, expect, it, vi } from 'vitest';

import {
  buildRequestUrl,
  createLastUpdateRecord,
  extractNameFromId,
  filterCatalogFlows,
  mergeCatalogItems,
  withFailedAction,
} from '../server/client-helpers.js';
import type { FlowCatalog, FlowCatalogItem, NormalizedFlow, RunSummary } from '../server/schemas.js';

describe('client helpers', () => {
  it('builds request URLs with api-version and trailing slash handling', () => {
    const url = buildRequestUrl('https://example.test/root', 'powerautomate/flows/123', '1');

    expect(url.toString()).toBe('https://example.test/root/powerautomate/flows/123?api-version=1');
  });

  it('merges catalog items and preserves richer sharing info', () => {
    const owned: FlowCatalogItem = {
      accessScope: 'owned',
      displayName: 'Flow A',
      envId: 'env',
      flowId: 'flow-a',
    };
    const shared: FlowCatalogItem = {
      accessScope: 'shared-user',
      creatorObjectId: 'creator-1',
      displayName: 'Flow A',
      envId: 'env',
      flowId: 'flow-a',
      sharingType: 'Coauthor',
      userType: 'User',
    };

    const merged = mergeCatalogItems([owned], [shared]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      accessScope: 'shared-user',
      creatorObjectId: 'creator-1',
      sharingType: 'Coauthor',
    });
  });

  it('filters flow catalogs by query and limit', () => {
    const catalog: FlowCatalog = {
      capturedAt: '2026-04-01T00:00:00.000Z',
      envId: 'env',
      flows: [
        { displayName: 'Alpha Flow', envId: 'env', flowId: 'a' },
        { displayName: 'Beta Flow', envId: 'env', flowId: 'b' },
      ],
      source: 'test',
    };

    const filtered = filterCatalogFlows(catalog, { limit: 1, query: 'beta' });

    expect(filtered.total).toBe(1);
    expect(filtered.flows).toEqual([{ displayName: 'Beta Flow', envId: 'env', flowId: 'b' }]);
  });

  it('creates history summaries from before/after flows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));

    const before: NormalizedFlow = {
      displayName: 'Before',
      envId: 'env',
      flow: {
        $schema: 'schema',
        connectionReferences: {},
        definition: {
          actions: {
            Compose: { type: 'Compose' },
          },
          triggers: {
            manual: { type: 'Request' },
          },
        },
      },
      flowId: 'flow-id',
    };
    const after: NormalizedFlow = {
      ...before,
      displayName: 'After',
      flow: {
        ...before.flow,
        connectionReferences: { shared: { connection: 'x' } },
        definition: {
          actions: {
            Compose2: { type: 'Compose' },
          },
          triggers: before.flow.definition.triggers,
        },
      },
    };

    const result = createLastUpdateRecord({ after, before });

    expect(result.capturedAt).toBe('2026-04-01T12:00:00.000Z');
    expect(result.summary.changedDisplayName).toBe(true);
    expect(result.summary.changedFlowBody).toBe(true);
    expect(result.summary.changedActionNames).toContain('Compose');
    expect(result.summary.changedActionNames).toContain('Compose2');

    vi.useRealTimers();
  });

  it('extracts IDs from ARM-like resource paths and decorates failed runs', () => {
    const run: RunSummary = {
      flowId: 'flow-id',
      runId: 'run-id',
      status: 'Failed',
    };

    expect(extractNameFromId('/providers/test/runs/run-id')).toBe('run-id');
    expect(
      withFailedAction(run, [{ errorMessage: 'Boom', name: 'Compose', status: 'Failed' }]),
    ).toMatchObject({
      errorMessage: 'Boom',
      failedActionName: 'Compose',
    });
  });
});
