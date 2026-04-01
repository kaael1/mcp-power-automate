import { type ComponentType, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Cable,
  Clock3,
  Database,
  ExternalLink,
  Gauge,
  Pin,
  PinOff,
  Radar,
  RefreshCcw,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';

import type { HealthPayload } from '../../server/bridge-types.js';
import type { FlowCatalogItem } from '../../server/schemas.js';
import type { DashboardAction } from '../use-dashboard.js';
import type { DashboardAttentionItem, DashboardFlowReference, DashboardModel } from '../dashboard-model.js';
import { cn } from '../lib/utils.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible.js';
import { Input } from './ui/input.js';
import { ScrollArea } from './ui/scroll-area.js';
import { Separator } from './ui/separator.js';
import { Skeleton } from './ui/skeleton.js';

type SidePanelSection = 'current' | 'diagnostics' | 'flows' | 'today';

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return 'Not available';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const formatShortId = (value: string | null | undefined) => {
  if (!value) return 'Not available';
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
};

const relativeFromNow = (value: string | null | undefined) => {
  if (!value) return 'No timestamp yet';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) < 1) return 'Just now';
  if (Math.abs(diffMinutes) < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
};

const toneToBadgeVariant = (severity: DashboardAttentionItem['severity']) => {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'success':
      return 'good';
    case 'warning':
      return 'warning';
    default:
      return 'primary';
  }
};

const accessTone = (accessScope: FlowCatalogItem['accessScope']) => {
  switch (accessScope) {
    case 'owned':
      return 'good';
    case 'portal-shared':
      return 'warning';
    case 'shared-user':
      return 'primary';
    default:
      return 'neutral';
  }
};

const surfaceTone = (model: DashboardModel) => {
  if (!model.bridgeOnline) return 'critical';
  if (model.selectedTargetMismatch || !model.hasLegacyApi) return 'warning';
  if ((model.lastRunStatus || '').toLowerCase() === 'failed') return 'critical';
  return 'good';
};

const SurfaceHeader = ({
  compact,
  model,
}: {
  compact?: boolean;
  model: DashboardModel;
}) => {
  const tone = surfaceTone(model);
  const toneLabel =
    tone === 'good'
      ? 'Ready'
      : tone === 'warning'
        ? model.selectedTargetMismatch
          ? 'Target mismatch'
          : 'Refresh needed'
        : model.bridgeOnline
          ? 'Needs attention'
          : 'Bridge offline';

  return (
    <div className={cn('glass-panel p-4', compact ? 'rounded-[24px]' : 'rounded-[28px] p-5')}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Power Automate Daily Cockpit
          </div>
          <div>
            <h1 className={cn('font-semibold tracking-tight', compact ? 'text-xl' : 'text-2xl')}>
              {model.statusLabel}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{model.statusMessage}</p>
          </div>
        </div>
        <Badge variant={tone === 'good' ? 'good' : tone === 'warning' ? 'warning' : 'critical'}>{toneLabel}</Badge>
      </div>
    </div>
  );
};

const QuickStat = ({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone?: 'default' | 'good' | 'warning';
  value: string;
}) => (
  <div className="rounded-2xl border bg-white/80 px-3 py-3 shadow-sm">
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-2xl',
          tone === 'good'
            ? 'bg-success/10 text-success'
            : tone === 'warning'
              ? 'bg-warning/10 text-warning'
              : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-medium leading-5 text-foreground">{value}</p>
      </div>
    </div>
  </div>
);

const DetailRow = ({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) => (
  <div className="rounded-2xl border bg-muted/35 px-3 py-2.5">
    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
    <div className={cn('mt-1.5 text-sm font-medium text-foreground', mono && 'font-mono text-xs')}>{value}</div>
  </div>
);

const FlowContextCard = ({
  caption,
  flow,
  icon: Icon,
}: {
  caption: string;
  flow: DashboardFlowReference | null;
  icon: ComponentType<{ className?: string }>;
}) => (
  <Card>
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker">{caption}</p>
          <CardTitle className="mt-2 text-base">{flow?.displayName || 'No flow available'}</CardTitle>
        </div>
        <div className="rounded-2xl bg-primary/10 p-2 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </CardHeader>
    <CardContent className="grid gap-3">
      <DetailRow label="Flow ID" mono value={formatShortId(flow?.flowId)} />
      <DetailRow label="Environment" value={flow?.envId || 'Not available'} />
      <div className="flex flex-wrap gap-2">
        <Badge variant={accessTone(flow?.accessScope)}>{flow?.accessScope || 'No access scope'}</Badge>
        {flow?.selectionSource ? <Badge variant="neutral">{flow.selectionSource}</Badge> : null}
        {flow?.isPinned ? <Badge variant="primary">Pinned</Badge> : null}
      </div>
    </CardContent>
  </Card>
);

const RunCard = ({ model }: { model: DashboardModel }) => (
  <Card>
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker">Run health</p>
          <CardTitle className="mt-2 text-base">Latest execution</CardTitle>
          <CardDescription className="mt-2">Focused on the last known run for the selected target.</CardDescription>
        </div>
        <div className="rounded-2xl bg-primary/10 p-2 text-primary">
          <Activity className="h-4.5 w-4.5" />
        </div>
      </div>
    </CardHeader>
    <CardContent className="grid gap-3">
      <DetailRow label="Status" value={model.lastRun?.status || 'No run cached'} />
      <DetailRow label="Run ID" mono value={formatShortId(model.lastRun?.runId)} />
      <DetailRow label="Started" value={formatDateTime(model.lastRun?.startTime)} />
      <DetailRow label="Failed action" value={model.lastRun?.failedActionName || 'No failed action captured'} />
    </CardContent>
  </Card>
);

const UpdateCard = ({ model }: { model: DashboardModel }) => (
  <Card>
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker">Change safety</p>
          <CardTitle className="mt-2 text-base">Latest saved change</CardTitle>
          <CardDescription className="mt-2">The most recent cached update and rollback context for this target.</CardDescription>
        </div>
        <div className="rounded-2xl bg-primary/10 p-2 text-primary">
          <Gauge className="h-4.5 w-4.5" />
        </div>
      </div>
    </CardHeader>
    <CardContent className="grid gap-3">
      <DetailRow label="Captured" value={formatDateTime(model.lastUpdate?.capturedAt)} />
      <DetailRow
        label="Change type"
        value={
          model.lastUpdate
            ? model.lastUpdate.summary?.changedFlowBody
              ? 'Logic changed'
              : model.lastUpdate.summary?.changedDisplayName
                ? 'Name only'
                : 'Metadata only'
            : 'No update cached'
        }
      />
      <DetailRow label="Before" value={model.lastUpdate?.summary?.beforeDisplayName || 'No previous snapshot'} />
      <DetailRow label="After" value={model.lastUpdate?.summary?.afterDisplayName || 'No updated snapshot'} />
    </CardContent>
  </Card>
);

const AttentionList = ({
  items,
  onAction,
  pendingAction,
}: {
  items: DashboardAttentionItem[];
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
}) => (
  <div className="space-y-3">
    {items.map((item) => (
      <Card className="border-white/60 bg-white/90" key={item.id}>
        <CardContent className="flex items-start justify-between gap-4 px-4 py-4">
          <div className="space-y-2">
            <Badge variant={toneToBadgeVariant(item.severity)}>{item.severity}</Badge>
            <div>
              <h3 className="text-sm font-semibold leading-6">{item.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </div>
          </div>
          {item.actionType && item.actionLabel ? (
            <Button
              className="shrink-0"
              onClick={() => {
                const actionType = item.actionType;
                if (!actionType) return;
                onAction({ type: actionType });
              }}
              size="sm"
              variant={item.severity === 'critical' ? 'default' : 'secondary'}
            >
              {pendingAction === item.actionType ? 'Working...' : item.actionLabel}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    ))}
  </div>
);

const DiagnosticsCard = ({ model }: { model: DashboardModel }) => (
  <Collapsible>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="kicker">Diagnostics</p>
            <CardTitle className="mt-2 text-base">Low-level bridge and capture details</CardTitle>
          </div>
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost">
              Toggle
            </Button>
          </CollapsibleTrigger>
        </div>
      </CardHeader>
      <CollapsibleContent>
        <CardContent className="grid gap-3">
          <DetailRow label="Bridge mode" value={model.bridgeMode || 'Unavailable'} />
          <DetailRow label="Token source" value={model.diagnostics.tokenSource || 'No token source yet'} />
          <DetailRow label="Snapshot source" value={model.diagnostics.snapshotSource || 'No snapshot source yet'} />
          <DetailRow label="Captured" value={formatDateTime(model.diagnostics.capturedAt)} />
          <DetailRow label="Last sent" value={formatDateTime(model.diagnostics.lastSentAt)} />
          <DetailRow label="Error" value={model.diagnostics.error || 'No active error'} />
        </CardContent>
      </CollapsibleContent>
    </Card>
  </Collapsible>
);

const ActionButton = ({
  action,
  disabled,
  icon: Icon,
  label,
  onAction,
  pendingAction,
  variant,
}: {
  action: DashboardAction;
  disabled?: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
  variant: 'default' | 'outline' | 'secondary';
}) => (
  <Button disabled={disabled} onClick={() => onAction(action)} variant={variant}>
    <Icon className="h-4 w-4" />
    {pendingAction === action.type ? 'Working...' : label}
  </Button>
);

const ActionGrid = ({
  model,
  onAction,
  pendingAction,
  includeOpenSidePanel,
}: {
  includeOpenSidePanel?: boolean;
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
}) => (
  <div className="grid gap-3 sm:grid-cols-2">
    <ActionButton action={{ type: 'refresh-current-tab' }} icon={RefreshCcw} label="Refresh capture" onAction={onAction} pendingAction={pendingAction} variant="default" />
    <ActionButton
      action={{ type: 'set-active-flow-from-tab' }}
      disabled={!model.currentTab?.flowId}
      icon={ArrowRightLeft}
      label="Use current tab"
      onAction={onAction}
      pendingAction={pendingAction}
      variant="secondary"
    />
    <ActionButton action={{ type: 'refresh-last-run' }} disabled={!model.hasSession} icon={Activity} label="Refresh run status" onAction={onAction} pendingAction={pendingAction} variant="secondary" />
    <ActionButton action={{ type: 'revert-last-update' }} disabled={!model.lastUpdate} icon={RotateCcw} label="Revert last update" onAction={onAction} pendingAction={pendingAction} variant="outline" />
    {includeOpenSidePanel ? (
      <ActionButton action={{ type: 'open-side-panel' }} icon={ExternalLink} label="Open side panel" onAction={onAction} pendingAction={pendingAction} variant="outline" />
    ) : null}
  </div>
);

const SidebarFlowMiniList = ({
  emptyMessage,
  flows,
  onAction,
  pendingAction,
}: {
  emptyMessage: string;
  flows: DashboardFlowReference[];
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
}) => {
  if (flows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-2">
      {flows.slice(0, 4).map((flow) => (
        <button className="flex w-full items-center justify-between rounded-2xl border bg-white/60 px-3 py-2.5 text-left transition hover:bg-white" key={flow.flowId} onClick={() => onAction({ flowId: flow.flowId, type: 'set-active-flow' })} type="button">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{flow.displayName}</div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{formatShortId(flow.flowId)}</div>
          </div>
          <Badge variant={pendingAction === 'set-active-flow' ? 'primary' : accessTone(flow.accessScope)}>{flow.accessScope || 'flow'}</Badge>
        </button>
      ))}
    </div>
  );
};

const FlowCatalogRow = ({
  flow,
  isActive,
  isPinned,
  onAction,
  pendingAction,
}: {
  flow: FlowCatalogItem;
  isActive: boolean;
  isPinned: boolean;
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
}) => (
  <div className="rounded-2xl border bg-white/85 px-4 py-3 shadow-sm transition hover:border-primary/30 hover:bg-white">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold leading-6">{flow.displayName}</h3>
          {isActive ? <Badge variant="good">Active</Badge> : null}
          <Badge variant={accessTone(flow.accessScope)}>{flow.accessScope || 'access unknown'}</Badge>
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{flow.flowId}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {flow.state ? <span>State: {flow.state}</span> : null}
          {flow.lastModifiedTime ? <span>Updated: {relativeFromNow(flow.lastModifiedTime)}</span> : null}
          {flow.triggerTypes?.length ? <span>Trigger: {flow.triggerTypes[0]}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button onClick={() => onAction({ flowId: flow.flowId, type: 'toggle-pinned-flow' })} size="icon" title={isPinned ? 'Unpin flow' : 'Pin flow'} variant="ghost">
          {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </Button>
        <Button onClick={() => onAction({ flowId: flow.flowId, type: 'set-active-flow' })} size="sm" variant={isActive ? 'outline' : 'secondary'}>
          {pendingAction === 'set-active-flow' && isActive ? 'Active' : 'Target'}
        </Button>
      </div>
    </div>
  </div>
);

const CompactComparison = ({ model }: { model: DashboardModel }) => (
  <Card>
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker">Target vs tab</p>
          <CardTitle className="mt-2 text-base">Stay on the right flow</CardTitle>
        </div>
        <Badge variant={model.selectedTargetMismatch ? 'warning' : 'good'}>
          {model.selectedTargetMismatch ? 'Different flows' : 'Aligned'}
        </Badge>
      </div>
    </CardHeader>
    <CardContent className="grid gap-3 sm:grid-cols-2">
      <FlowContextCard caption="Selected target" flow={model.activeTarget} icon={Target} />
      <FlowContextCard caption="Current tab" flow={model.currentTab} icon={Cable} />
    </CardContent>
  </Card>
);

export const PopupDashboardView = ({
  model,
  onAction,
  pendingAction,
}: {
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
}) => (
  <div className="min-h-[720px] p-4">
    <div className="mx-auto flex max-w-[500px] flex-col gap-4">
      <SurfaceHeader compact model={model} />

      <div className="grid grid-cols-2 gap-3">
        <QuickStat icon={Server} label="Bridge" tone={model.bridgeOnline ? 'good' : 'warning'} value={model.bridgeOnline ? 'Online' : 'Offline'} />
        <QuickStat icon={ShieldCheck} label="Legacy" tone={model.hasLegacyApi ? 'good' : 'warning'} value={model.hasLegacyApi ? 'Ready' : 'Needs refresh'} />
        <QuickStat icon={Clock3} label="Captured" value={relativeFromNow(model.diagnostics.capturedAt)} />
        <QuickStat icon={Database} label="Environment" value={model.diagnostics.envId || 'Unknown env'} />
      </div>

      <CompactComparison model={model} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="kicker">Attention</p>
              <CardTitle className="mt-2 text-base">What needs your attention</CardTitle>
            </div>
            <AlertTriangle className="mt-1 h-4.5 w-4.5 text-warning" />
          </div>
        </CardHeader>
        <CardContent>
          <AttentionList items={model.attentionItems.slice(0, 1)} onAction={onAction} pendingAction={pendingAction} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <RunCard model={model} />
        <UpdateCard model={model} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <p className="kicker">Actions</p>
          <CardTitle className="mt-2 text-base">Safe next steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionGrid includeOpenSidePanel model={model} onAction={onAction} pendingAction={pendingAction} />
        </CardContent>
      </Card>

      <DiagnosticsCard model={model} />
    </div>
  </div>
);

const SidebarNav = ({
  model,
  onAction,
  pendingAction,
  section,
  setSection,
}: {
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
  section: SidePanelSection;
  setSection: (section: SidePanelSection) => void;
}) => {
  const navItems: Array<{
    icon: ComponentType<{ className?: string }>;
    id: SidePanelSection;
    label: string;
    subtitle: string;
  }> = [
    { icon: Radar, id: 'today', label: 'Today', subtitle: 'Attention and signals' },
    { icon: Target, id: 'current', label: 'Current', subtitle: 'Target, run, and safety' },
    { icon: Database, id: 'flows', label: 'Flows', subtitle: 'Recent, pinned, and catalog' },
    { icon: AlertTriangle, id: 'diagnostics', label: 'Diagnostics', subtitle: 'Bridge and capture internals' },
  ];

  return (
    <aside className="glass-panel flex h-[calc(100vh-3rem)] w-[284px] shrink-0 flex-col p-4">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Power Automate
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Daily cockpit</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Context, safety, and the right next action for daily makers.
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <QuickStat icon={Server} label="Bridge" tone={model.bridgeOnline ? 'good' : 'warning'} value={model.bridgeOnline ? 'Online' : 'Offline'} />
          <QuickStat icon={ShieldCheck} label="Legacy" tone={model.hasLegacyApi ? 'good' : 'warning'} value={model.hasLegacyApi ? 'Ready' : 'Needs refresh'} />
          <QuickStat icon={Clock3} label="Capture" value={relativeFromNow(model.diagnostics.capturedAt)} />
        </div>
      </div>

      <Separator className="my-4" />

      <div className="space-y-2">
        {navItems.map((item) => (
          <button
            className={cn(
              'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition',
              section === item.id ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/15' : 'bg-white/60 hover:bg-white',
            )}
            key={item.id}
            onClick={() => setSection(item.id)}
            type="button"
          >
            <item.icon className={cn('mt-0.5 h-4.5 w-4.5 shrink-0', section === item.id ? 'text-primary-foreground' : 'text-primary')} />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{item.label}</div>
              <div className={cn('mt-1 text-xs', section === item.id ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {item.subtitle}
              </div>
            </div>
          </button>
        ))}
      </div>

      <Separator className="my-4" />

      <div className="space-y-4 overflow-hidden">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pinned</div>
          <SidebarFlowMiniList emptyMessage="No pinned flows." flows={model.pinnedFlows} onAction={onAction} pendingAction={pendingAction} />
        </div>
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recent</div>
          <SidebarFlowMiniList emptyMessage="No recent flows." flows={model.recentFlows} onAction={onAction} pendingAction={pendingAction} />
        </div>
      </div>
    </aside>
  );
};

export const SidePanelDashboardView = ({
  model,
  onAction,
  pendingAction,
}: {
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
  pendingAction: string | null;
}) => {
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<SidePanelSection>('today');

  const filteredFlows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return model.catalogFlows;

    return model.catalogFlows.filter((flow) => flow.displayName.toLowerCase().includes(normalized));
  }, [model.catalogFlows, query]);

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto flex max-w-[1440px] gap-6">
        <SidebarNav model={model} onAction={onAction} pendingAction={pendingAction} section={section} setSection={setSection} />

        <main className="min-w-0 flex-1">
          <div className="space-y-5">
            <SurfaceHeader model={model} />

            {section === 'today' ? (
              <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-4">
                  <AttentionList items={model.attentionItems} onAction={onAction} pendingAction={pendingAction} />
                </div>
                <div className="grid gap-4">
                  <CompactComparison model={model} />
                  <Card>
                    <CardHeader>
                      <p className="kicker">Today at a glance</p>
                      <CardTitle className="mt-2 text-base">Your current operating context</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      <DetailRow label="Current status" value={model.statusLabel} />
                      <DetailRow label="Bridge mode" value={model.bridgeMode || 'Unavailable'} />
                      <DetailRow label="Last run" value={model.lastRunStatus || 'No recent run'} />
                      <DetailRow label="Pinned flows" value={`${model.pinnedFlows.length}`} />
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}

            {section === 'current' ? (
              <div className="space-y-5">
                <CompactComparison model={model} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <RunCard model={model} />
                  <UpdateCard model={model} />
                </div>
                <Card>
                  <CardHeader>
                    <p className="kicker">Actions</p>
                    <CardTitle className="mt-2 text-base">Safe next steps for this flow</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ActionGrid model={model} onAction={onAction} pendingAction={pendingAction} />
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {section === 'flows' ? (
              <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
                <Card className="h-fit">
                  <CardHeader>
                    <p className="kicker">Working set</p>
                    <CardTitle className="mt-2 text-base">Pinned and recent flows</CardTitle>
                    <CardDescription className="mt-2">
                      Keep your day-to-day flows close and retarget the MCP without leaving the cockpit.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Input onChange={(event) => setQuery(event.target.value)} placeholder="Search flows by name..." value={query} />

                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pinned</div>
                      <SidebarFlowMiniList emptyMessage="No pinned flows." flows={model.pinnedFlows} onAction={onAction} pendingAction={pendingAction} />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recent</div>
                      <SidebarFlowMiniList emptyMessage="No recent flows." flows={model.recentFlows} onAction={onAction} pendingAction={pendingAction} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="kicker">Environment catalog</p>
                        <CardTitle className="mt-2 text-base">Flows available to this session</CardTitle>
                        <CardDescription className="mt-2">
                          {model.flowCatalogMessage || 'A denser list for retargeting, triage, and daily navigation.'}
                        </CardDescription>
                      </div>
                      <Badge variant="neutral">{filteredFlows.length} visible</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[640px] pr-3">
                      <div className="grid gap-3">
                        {filteredFlows.map((flow) => (
                          <FlowCatalogRow
                            flow={flow}
                            isActive={model.activeTarget?.flowId === flow.flowId}
                            isPinned={model.pinnedFlows.some((item) => item.flowId === flow.flowId)}
                            key={flow.flowId}
                            onAction={onAction}
                            pendingAction={pendingAction}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {section === 'diagnostics' ? <DiagnosticsCard model={model} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
};

export const LoadingView = ({ surface }: { surface: 'popup' | 'sidepanel' }) => (
  <div className={cn('p-4', surface === 'sidepanel' && 'min-h-screen p-6')}>
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4">
      <Skeleton className="h-28 rounded-[28px]" />
      <div className={cn('grid gap-4', surface === 'sidepanel' ? 'xl:grid-cols-[284px_1fr]' : 'grid-cols-1')}>
        {surface === 'sidepanel' ? <Skeleton className="h-[760px] rounded-[28px]" /> : null}
        <div className="grid gap-4">
          <Skeleton className="h-44 rounded-[24px]" />
          <Skeleton className="h-60 rounded-[24px]" />
          <Skeleton className="h-56 rounded-[24px]" />
        </div>
      </div>
    </div>
  </div>
);

export const ErrorView = ({
  bridgeHealth,
  error,
  onRetry,
  surface,
}: {
  bridgeHealth: HealthPayload | null;
  error: string;
  onRetry: () => void;
  surface: 'popup' | 'sidepanel';
}) => (
  <div className={cn('p-4', surface === 'sidepanel' && 'min-h-screen p-6')}>
    <div className="mx-auto max-w-3xl">
      <Card className="glass-panel border-destructive/20 bg-white/90">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="kicker">Extension recovery</p>
              <CardTitle className="mt-2 text-2xl">The background worker needs attention</CardTitle>
              <CardDescription className="mt-3 max-w-2xl text-sm leading-6">
                {bridgeHealth?.ok
                  ? 'The local bridge is reachable, but the extension background worker did not answer correctly.'
                  : 'The popup cannot talk to the extension background or the local bridge right now.'}
              </CardDescription>
            </div>
            <Badge variant="critical">Needs reload</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-destructive/10 bg-destructive/5 p-4 text-sm leading-6 text-destructive">
            {error}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow label="Bridge status" value={bridgeHealth?.ok ? 'Online' : 'Offline'} />
            <DetailRow label="Captured at" value={formatDateTime(bridgeHealth?.capturedAt || null)} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={onRetry}>
              <RefreshCcw className="h-4 w-4" />
              Retry now
            </Button>
            <Badge variant="warning">Reload the extension from dist/extension if this persists</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);
