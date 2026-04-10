import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ErrorView,
  PopupDashboardView,
  SidePanelDashboardView,
} from '../extension/components/dashboard-view.js';
import { deriveDashboardModel } from '../extension/dashboard-model.js';
import type { DashboardPayload } from '../extension/types.js';

const noop = () => {};

const buildPayload = (): DashboardPayload => ({
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
  pinnedFlowIds: ['flow-a'],
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
        displayName: 'Flow B',
        envId: 'Default-123',
        flowId: 'flow-b',
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
      flowId: 'flow-b',
      run: {
        failedActionName: 'Compose Customer',
        flowId: 'flow-b',
        runId: 'run-2',
        startTime: '2026-04-01T10:00:00.000Z',
        status: 'Failed',
      },
    },
    lastSentAt: '2026-04-01T10:03:30.000Z',
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
        displayName: 'Flow B old',
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
    session: {
      apiToken: 'Bearer test',
      apiUrl: 'https://example.api.powerplatform.com/',
      capturedAt: '2026-04-01T10:02:00.000Z',
      envId: 'Default-123',
      flowId: 'flow-a',
      legacyApiUrl: 'https://api.flow.microsoft.com/',
      legacyToken: 'Bearer legacy',
    },
    snapshot: {
      capturedAt: '2026-04-01T10:02:00.000Z',
      displayName: 'Flow A',
      envId: 'Default-123',
      flow: {
        connectionReferences: {},
        definition: {},
      },
      flowId: 'flow-a',
      source: 'bridge-cache',
    },
    tokenAudit: null,
    tokenMeta: {
      score: 500,
      scope: 'scope',
      source: 'request-header',
    },
  },
});

const buildModel = () => deriveDashboardModel(buildPayload(), 'en');

const renderPopup = () =>
  renderToStaticMarkup(
    createElement(PopupDashboardView, {
      locale: 'en',
      model: buildModel(),
      onAction: noop,
      onLocaleChange: noop,
    }),
  );

const renderPanel = (initialSection: 'flows' | 'review' | 'system' | 'today') =>
  renderToStaticMarkup(
    createElement(SidePanelDashboardView, {
      initialSection,
      locale: 'en',
      model: buildModel(),
      onAction: noop,
      onLocaleChange: noop,
    }),
  );

describe('dashboard view', () => {
  it('keeps the popup focused on quick actions and hides detailed review by default', () => {
    const html = renderPopup();

    expect(html).toContain('Quick actions');
    expect(html).toContain('Latest run');
    expect(html).toContain('Latest change');
    expect(html).toContain('System details');
    expect(html).not.toContain('Exactly what changed in the flow');
    expect(html).not.toContain('request-header');
  });

  it('shows the full attention queue in the today workspace', () => {
    const html = renderPanel('today');

    expect(html).toContain('You opened a different flow.');
    expect(html).toContain('The latest run needs review.');
    expect(html).toContain('Selected target');
  });

  it('renders the cached diff only inside the review workspace', () => {
    const html = renderPanel('review');

    expect(html).toContain('Exactly what changed in the flow');
    expect(html).toContain('Flow name');
    expect(html).toContain('Flow B old');
  });

  it('moves locale controls and diagnostics into the system workspace', () => {
    const html = renderPanel('system');

    expect(html).toContain('Interface language');
    expect(html).toContain('request-header');
    expect(html).toContain('bridge-cache');
  });

  it('renders a compact recovery state for bridge failures', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorView, {
        bridgeHealth: null,
        error: 'Connection refused',
        locale: 'en',
        onLocaleChange: noop,
        onRetry: noop,
        surface: 'popup',
      }),
    );

    expect(html).toContain('Connection issue');
    expect(html).toContain('Bridge offline');
    expect(html).toContain('Connection refused');
  });
});
