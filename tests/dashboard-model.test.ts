import { describe, expect, it } from 'vitest';

import { deriveDashboardModel } from '../extension/dashboard-model.js';
import type { DashboardPayload } from '../extension/types.js';

const basePayload: DashboardPayload = {
  flowCatalog: {
    capturedAt: '2026-04-01T10:00:00.000Z',
    envId: 'Default-123',
    flows: [
      {
        accessScope: 'owned',
        displayName: 'Flow A',
        envId: 'Default-123',
        flowId: 'flow-a',
        lastModifiedTime: '2026-04-01T09:50:00.000Z',
        triggerTypes: ['Recurrence'],
      },
      {
        accessScope: 'shared-user',
        displayName: 'Flow B',
        envId: 'Default-123',
        flowId: 'flow-b',
        lastModifiedTime: '2026-04-01T09:45:00.000Z',
        triggerTypes: ['Request'],
      },
    ],
    source: 'test',
    total: 2,
  },
  pinnedFlowIds: ['flow-b'],
  recentFlowIds: ['flow-a', 'flow-b'],
  status: {
    activeFlow: {
      activeTarget: {
        displayName: 'Flow A',
        envId: 'Default-123',
        flowId: 'flow-a',
        selectedAt: '2026-04-01T10:01:00.000Z',
        selectionSource: 'manual',
      },
      currentTab: {
        displayName: 'Flow A',
        envId: 'Default-123',
        flowId: 'flow-a',
      },
    },
    bridge: {
      bridgeMode: 'owned',
      capturedAt: '2026-04-01T10:02:00.000Z',
      envId: 'Default-123',
      hasLegacyApi: true,
      hasSession: true,
      ok: true,
    },
    lastError: null,
    lastRun: {
      capturedAt: '2026-04-01T10:03:00.000Z',
      envId: 'Default-123',
      flowId: 'flow-a',
      run: {
        flowId: 'flow-a',
        runId: 'run-1',
        status: 'Succeeded',
      },
    },
    lastSentAt: '2026-04-01T10:03:30.000Z',
    lastUpdate: null,
    session: {
      apiToken: 'Bearer test',
      apiUrl: 'https://example.api.powerplatform.com/',
      capturedAt: '2026-04-01T10:02:00.000Z',
      envId: 'Default-123',
      flowId: 'flow-a',
      legacyApiUrl: 'https://api.flow.microsoft.com/',
      legacyToken: 'Bearer legacy',
    },
    snapshot: null,
    tokenAudit: null,
    tokenMeta: {
      score: 500,
      scope: 'scope',
      source: 'request-header',
    },
  },
};

describe('dashboard model', () => {
  it('derives a healthy aligned state', () => {
    const model = deriveDashboardModel(basePayload);

    expect(model.statusLabel).toBe('Ready');
    expect(model.selectedTargetMismatch).toBe(false);
    expect(model.attentionItems[0]?.severity).toBe('success');
    expect(model.pinnedFlows.map((flow) => flow.flowId)).toEqual(['flow-b']);
    expect(model.recentFlows.map((flow) => flow.flowId)).toEqual(['flow-a', 'flow-b']);
  });

  it('raises target mismatch and failed run attention', () => {
    const model = deriveDashboardModel({
      ...basePayload,
      status: {
        ...basePayload.status,
        activeFlow: {
          activeTarget: {
            displayName: 'Flow A',
            envId: 'Default-123',
            flowId: 'flow-a',
            selectedAt: '2026-04-01T10:01:00.000Z',
            selectionSource: 'manual',
          },
          currentTab: {
            displayName: 'Flow B',
            envId: 'Default-123',
            flowId: 'flow-b',
          },
        },
        lastRun: {
          capturedAt: '2026-04-01T10:03:00.000Z',
          envId: 'Default-123',
          flowId: 'flow-a',
          run: {
            failedActionName: 'Compose Customer',
            flowId: 'flow-a',
            runId: 'run-2',
            status: 'Failed',
          },
        },
      },
    });

    expect(model.statusLabel).toBe('Target mismatch');
    expect(model.selectedTargetMismatch).toBe(true);
    expect(model.attentionItems.some((item) => item.id === 'target-mismatch')).toBe(true);
    expect(model.attentionItems.some((item) => item.id === 'last-run-failed')).toBe(true);
  });

  it('warns when the legacy token is not ready', () => {
    const model = deriveDashboardModel({
      ...basePayload,
      status: {
        ...basePayload.status,
        bridge: {
          ...basePayload.status.bridge,
          hasLegacyApi: false,
        },
        session: {
          ...basePayload.status.session!,
          legacyApiUrl: undefined,
          legacyToken: undefined,
        },
      },
    });

    expect(model.hasLegacyApi).toBe(false);
    expect(model.statusLabel).toBe('Session needs refresh');
    expect(model.attentionItems.some((item) => item.id === 'legacy-missing')).toBe(true);
  });
});
