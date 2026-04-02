import { AlertTriangle, ChevronRight, History, Play } from 'lucide-react';

import type { DashboardAttentionItem, DashboardModel } from '../../dashboard-model.js';
import { t, type Locale } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { InlineKv, RunStatusBadge, SeverityBadge, TimeAgo } from './atoms.js';

const truncate = (value: string | null | undefined, max: number) => {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

export function AttentionItemRow({
  className,
  item,
  locale,
  onAction,
}: {
  className?: string;
  item: DashboardAttentionItem;
  locale: Locale;
  onAction?: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors',
        item.severity === 'critical'
          ? 'border-rose-200 bg-rose-50/80'
          : item.severity === 'warning'
            ? 'border-amber-200 bg-amber-50/80'
            : item.severity === 'success'
              ? 'border-emerald-200 bg-emerald-50/80'
              : 'border-blue-200 bg-blue-50/80',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
          item.severity === 'critical'
            ? 'bg-rose-100'
            : item.severity === 'warning'
              ? 'bg-amber-100'
              : item.severity === 'success'
                ? 'bg-emerald-100'
                : 'bg-blue-100',
        )}
      >
        <AlertTriangle
          className={cn(
            'h-3.5 w-3.5',
            item.severity === 'critical'
              ? 'text-rose-600'
              : item.severity === 'warning'
                ? 'text-amber-600'
                : item.severity === 'success'
                  ? 'text-emerald-600'
                  : 'text-blue-600',
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h4 className="text-[13px] font-semibold text-foreground">{item.title}</h4>
          <SeverityBadge locale={locale} severity={item.severity} />
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
      </div>
      {item.actionLabel && onAction ? (
        <button
          className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-background"
          onClick={() => onAction(item.id)}
          type="button"
        >
          {item.actionLabel}
          <ChevronRight className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function AttentionBannerSingle({
  className,
  item,
  onAction,
}: {
  className?: string;
  item: DashboardAttentionItem;
  onAction?: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors',
        item.severity === 'critical'
          ? 'border-rose-200 bg-rose-50/80'
          : item.severity === 'warning'
            ? 'border-amber-200 bg-amber-50/80'
            : item.severity === 'success'
              ? 'border-emerald-200 bg-emerald-50/80'
              : 'border-blue-200 bg-blue-50/80',
        className,
      )}
    >
      <AlertTriangle
        className={cn(
          'h-4 w-4 flex-shrink-0',
          item.severity === 'critical'
            ? 'text-rose-600'
            : item.severity === 'warning'
              ? 'text-amber-600'
              : item.severity === 'success'
                ? 'text-emerald-600'
                : 'text-blue-600',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{item.title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{item.description}</p>
      </div>
      {item.actionLabel && onAction ? (
        <button className="flex-shrink-0 text-[11px] font-medium text-primary hover:underline" onClick={() => onAction(item.id)} type="button">
          {item.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function LastRunCard({
  className,
  locale,
  run,
}: {
  className?: string;
  locale: Locale;
  run: DashboardModel['lastRun'];
}) {
  return (
    <div className={cn('rounded-2xl border border-border bg-white p-3.5 shadow-sm', className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary">
            <Play className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-[13px] font-semibold text-foreground">{t(locale, 'Latest run', 'Última execução')}</p>
        </div>
        <RunStatusBadge locale={locale} status={run?.status} />
      </div>

      <div className="space-y-0.5">
        {run?.startTime ? <InlineKv label={t(locale, 'Started', 'Iniciou')} value={<TimeAgo date={run.startTime} locale={locale} />} /> : null}
        {run?.failedActionName ? <InlineKv label={t(locale, 'Stopped at', 'Parou em')} mono value={truncate(run.failedActionName, 24)} /> : null}
        {run?.runId ? <InlineKv dim label="Run ID" mono value={truncate(run.runId, 18)} /> : null}
        {!run ? <p className="text-[12px] text-muted-foreground">{t(locale, 'No cached run yet.', 'Sem execução em cache.')}</p> : null}
      </div>
    </div>
  );
}

export function LastUpdateCard({
  className,
  locale,
  update,
}: {
  className?: string;
  locale: Locale;
  update: DashboardModel['lastUpdate'];
}) {
  const changeCount = update?.review?.summary?.totalChanges;

  return (
    <div className={cn('rounded-2xl border border-border bg-white p-3.5 shadow-sm', className)}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-[13px] font-semibold text-foreground">{t(locale, 'Latest change', 'Última alteração')}</p>
      </div>

      <div className="space-y-0.5">
        {update?.capturedAt ? <InlineKv label={t(locale, 'Captured', 'Capturada')} value={<TimeAgo date={update.capturedAt} locale={locale} />} /> : null}
        {changeCount !== undefined ? (
          <InlineKv
            label={t(locale, 'Changes', 'Mudanças')}
            value={t(locale, `${changeCount} items`, `${changeCount} itens`)}
          />
        ) : null}
        {update?.summary?.changedDisplayName ? (
          <InlineKv
            label={t(locale, 'Name', 'Nome')}
            mono
            value={`${truncate(update.summary.beforeDisplayName, 12)} → ${truncate(update.summary.afterDisplayName, 12)}`}
          />
        ) : null}
        {update?.summary?.changedFlowBody ? <InlineKv label={t(locale, 'Logic', 'Lógica')} value={t(locale, 'Changed', 'Alterada')} /> : null}
        {!update ? <p className="text-[12px] text-muted-foreground">{t(locale, 'No cached change yet.', 'Sem alteração em cache.')}</p> : null}
      </div>
    </div>
  );
}
