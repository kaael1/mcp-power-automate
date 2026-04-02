import { ArrowLeftRight, ChevronRight, Workflow } from 'lucide-react';

import type { DashboardFlowReference } from '../../dashboard-model.js';
import { formatRelativeTime, t, type Locale } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { AccessScopeBadge, PinBadge } from './atoms.js';

const truncate = (value: string | null | undefined, max: number) => {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

export function FlowRefRow({
  actions,
  className,
  flow,
  isActive,
  locale,
  onClick,
}: {
  actions?: React.ReactNode;
  className?: string;
  flow: DashboardFlowReference;
  isActive?: boolean;
  locale: Locale;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
        isActive ? 'border-primary/30 bg-primary/10 shadow-sm' : 'border-border bg-white hover:border-primary/20 hover:bg-secondary/30',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
      onKeyDown={onClick ? (event) => event.key === 'Enter' && onClick() : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl', isActive ? 'bg-primary/20' : 'bg-secondary')}>
        <Workflow className={cn('h-3.5 w-3.5', isActive ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-[13px] font-medium', isActive ? 'text-primary' : 'text-foreground')}>{truncate(flow.displayName, 42)}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {flow.selectedAt
            ? t(locale, `Selected ${formatRelativeTime(locale, flow.selectedAt)}`, `Selecionado ${formatRelativeTime(locale, flow.selectedAt)}`)
            : t(locale, 'Ready', 'Pronto')}
        </p>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
        <PinBadge locale={locale} pinned={flow.isPinned} />
        <AccessScopeBadge locale={locale} scope={flow.accessScope} />
      </div>
      {actions ? <div className="flex-shrink-0 opacity-70 transition-opacity group-hover:opacity-100">{actions}</div> : null}
      {onClick ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" /> : null}
    </div>
  );
}

export function FlowRefCard({
  className,
  flow,
  label,
  locale,
  mismatch,
}: {
  className?: string;
  flow: DashboardFlowReference | null;
  label: string;
  locale: Locale;
  mismatch?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-[18px] p-3 transition-colors', mismatch ? 'bg-amber-50' : 'bg-secondary/35', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {flow ? (
        <>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/70">
              <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">{flow.displayName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{truncate(flow.flowId, 18)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <AccessScopeBadge locale={locale} scope={flow.accessScope} />
            <PinBadge locale={locale} pinned={flow.isPinned} />
          </div>
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">{t(locale, 'No flow selected.', 'Nenhum fluxo selecionado.')}</p>
      )}
    </div>
  );
}

export function TargetVsTabCard({
  activeTarget,
  className,
  currentTab,
  locale,
  mismatch,
}: {
  activeTarget: DashboardFlowReference | null;
  className?: string;
  currentTab: DashboardFlowReference | null;
  locale: Locale;
  mismatch: boolean;
}) {
  return (
    <div className={cn('overflow-hidden rounded-[22px] border border-border/70 bg-white/90 shadow-surface', className)}>
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">{t(locale, 'Selected vs tab', 'Selecionado vs aba')}</h3>
        {mismatch ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-600">
            <ArrowLeftRight className="h-3 w-3" />
            {t(locale, 'Different', 'Diferentes')}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-px bg-border/30">
        <FlowRefCard className="rounded-none bg-background/40" flow={activeTarget} label={t(locale, 'Selected', 'Selecionado')} locale={locale} />
        <FlowRefCard className="rounded-none" flow={currentTab} label={t(locale, 'Tab', 'Aba')} locale={locale} mismatch={mismatch} />
      </div>
    </div>
  );
}
