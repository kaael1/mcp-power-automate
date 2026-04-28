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
    context: null,
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

    expect(model.statusLabel).toBe('Connected');
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
          flowId: 'flow-b',
          run: {
            failedActionName: 'Compose Customer',
            flowId: 'flow-b',
            runId: 'run-2',
            status: 'Failed',
          },
        },
      },
    });

    expect(model.statusLabel).toBe('Sync available');
    expect(model.selectedTargetMismatch).toBe(true);
    expect(model.attentionItems.some((item) => item.id === 'target-mismatch')).toBe(true);
    expect(model.attentionItems.some((item) => item.id === 'last-run-failed')).toBe(true);
  });

  it('uses the current tab flow for last update review when it differs from the internal target', () => {
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
        lastUpdate: {
          after: {
            displayName: 'Flow B',
            envId: 'Default-123',
            flow: {
              $schema: 'schema',
              connectionReferences: {},
              definition: { actions: {}, triggers: {} },
            },
            flowId: 'flow-b',
          },
          before: {
            displayName: 'Flow B',
            envId: 'Default-123',
            flow: {
              $schema: 'schema',
              connectionReferences: {},
              definition: { actions: {}, triggers: {} },
            },
            flowId: 'flow-b',
          },
          capturedAt: '2026-04-01T10:05:00.000Z',
          envId: 'Default-123',
          flowId: 'flow-b',
          review: {
            changedPaths: ['displayName'],
            sections: [
              {
                id: 'metadata',
                items: [
                  {
                    afterValue: 'Flow B',
                    beforeValue: 'Flow B old',
                    changeType: 'modified',
                    detailPath: null,
                    entityName: null,
                    id: 'metadata:displayName:modified',
                    label: 'Flow name',
                    path: 'displayName',
                    sectionId: 'metadata',
                  },
                ],
              },
            ],
            summary: {
              changedSectionIds: ['metadata'],
              totalChanges: 1,
              unchangedSectionIds: ['triggers', 'actions', 'connections', 'other'],
            },
          },
          summary: {
            afterActionCount: 0,
            afterDisplayName: 'Flow B',
            afterTriggerCount: 0,
            beforeActionCount: 0,
            beforeDisplayName: 'Flow B old',
            beforeTriggerCount: 0,
            changedActionNames: [],
            changedDefinition: false,
            changedDisplayName: true,
            changedFlowBody: false,
          },
        },
      },
    });

    expect(model.lastUpdate?.flowId).toBe('flow-b');
  });

  it('normalizes a legacy cached last update that is missing review details', () => {
    const model = deriveDashboardModel({
      ...basePayload,
      status: {
        ...basePayload.status,
        lastUpdate: {
          after: {
            displayName: 'Flow A renamed',
            envId: 'Default-123',
            flow: {
              $schema: 'schema',
              connectionReferences: {},
              definition: {
                actions: {
                  ComposeCustomer: {
                    inputs: 'hello',
                    type: 'Compose',
                  },
                },
                triggers: {},
              },
            },
            flowId: 'flow-a',
          },
          before: {
            displayName: 'Flow A',
            envId: 'Default-123',
            flow: {
              $schema: 'schema',
              connectionReferences: {},
              definition: { actions: {}, triggers: {} },
            },
            flowId: 'flow-a',
          },
          capturedAt: '2026-04-01T10:05:00.000Z',
          envId: 'Default-123',
          flowId: 'flow-a',
        } as unknown as DashboardPayload['status']['lastUpdate'],
      },
    });

    expect(model.lastUpdate?.summary.changedDisplayName).toBe(true);
    expect(model.lastUpdate?.summary.changedFlowBody).toBe(true);
    expect(model.lastUpdate?.review.summary.totalChanges).toBeGreaterThan(0);
    expect(model.lastUpdate?.review.sections.length).toBeGreaterThan(0);
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
    expect(model.statusLabel).toBe('Setup needed');
    expect(model.attentionItems.some((item) => item.id === 'legacy-missing')).toBe(true);
  });

  it('treats a legacy-compatible token audit as ready for deeper actions', () => {
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
        tokenAudit: {
          candidates: [
            {
              aud: 'https://service.flow.microsoft.com/',
              score: 0,
              source: 'browser-storage',
              token: 'Bearer legacy-from-audit',
            },
          ],
          capturedAt: '2026-04-01T10:04:00.000Z',
          envId: 'Default-123',
          flowId: 'flow-a',
          source: 'browser-storage',
        },
      },
    });

    expect(model.hasLegacyApi).toBe(true);
    expect(model.statusLabel).toBe('Connected');
    expect(model.attentionItems.some((item) => item.id === 'legacy-missing')).toBe(false);
  });

  it('prefers centralized context capabilities when present', () => {
    const model = deriveDashboardModel({
      ...basePayload,
      status: {
        ...basePayload.status,
        bridge: {
          ...basePayload.status.bridge,
          hasLegacyApi: false,
          hasSession: false,
        },
        context: {
          context: {
            capabilities: {
              canManageSolutions: { available: false, reason: null, reasonCode: null },
              canReadFlow: { available: true, reason: null, reasonCode: null },
              canReadFlows: { available: true, reason: null, reasonCode: null },
              canReadRuns: { available: true, reason: null, reasonCode: null },
              canUpdateFlow: { available: true, reason: null, reasonCode: null },
              canUseLegacyApi: { available: true, reason: null, reasonCode: null },
              canValidateFlow: { available: true, reason: null, reasonCode: null },
            },
            diagnostics: {
              bridgeMode: 'owned',
              envId: 'Default-123',
              lastRunCapturedAt: null,
              lastUpdateCapturedAt: null,
              legacySource: 'captured-modern-session',
              snapshotCapturedAt: null,
              storeHealth: {
                items: [],
                ok: true,
              },
              tokenAuditCapturedAt: null,
            },
            selection: {
              activeTarget: {
                displayName: 'Flow A',
                envId: 'Default-123',
                flowId: 'flow-a',
                selectedAt: '2026-04-01T10:01:00.000Z',
                selectionSource: 'manual',
              },
              capturedSessions: [
                {
                  capturedAt: '2026-04-01T10:02:00.000Z',
                  displayName: 'Flow A',
                  envId: 'Default-123',
                  flowId: 'flow-a',
                  hasLegacyApi: true,
                  isSelected: true,
                  lastSeenAt: '2026-04-01T10:02:00.000Z',
                  portalUrl: 'https://make.powerautomate.com',
                  tabId: 123,
                },
              ],
              currentTab: {
                displayName: 'Flow A',
                envId: 'Default-123',
                flowId: 'flow-a',
              },
              resolvedTarget: {
                displayName: 'Flow A',
                envId: 'Default-123',
                flowId: 'flow-a',
                selectedAt: '2026-04-01T10:01:00.000Z',
                selectionSource: 'manual',
              },
              selectedWorkSession: {
                capturedAt: '2026-04-01T10:02:00.000Z',
                displayName: 'Flow A',
                envId: 'Default-123',
                flowId: 'flow-a',
                hasLegacyApi: true,
                isSelected: true,
                lastSeenAt: '2026-04-01T10:02:00.000Z',
                portalUrl: 'https://make.powerautomate.com',
                tabId: 123,
              },
            },
            session: {
              capturedAt: '2026-04-01T10:02:00.000Z',
              connected: true,
              envId: 'Default-123',
              flowId: 'flow-a',
              portalUrl: 'https://make.powerautomate.com',
            },
          },
          lastRun: basePayload.status.lastRun,
          lastUpdate: null,
          ok: true,
        },
      },
    });

    expect(model.hasSession).toBe(true);
    expect(model.hasLegacyApi).toBe(true);
    expect(model.statusLabel).toBe('Connected');
  });
});
