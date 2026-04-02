import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Database, Key, Send, Settings2 } from 'lucide-react';

import { formatRelativeTime, t, type Locale } from '../../i18n.js';
import type { DashboardModel } from '../../dashboard-model.js';
import { cn } from '../../lib/utils.js';
import { InlineKv, StatusDot } from './atoms.js';

const truncate = (value: string | null | undefined, max: number) => {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

export function DiagnosticsBlock({
  bridgeMode,
  bridgeOnline,
  className,
  collapsible = true,
  diagnostics,
  locale,
}: {
  bridgeMode: string | null;
  bridgeOnline: boolean;
  className?: string;
  collapsible?: boolean;
  diagnostics: DashboardModel['diagnostics'];
  locale: Locale;
}) {
  const [open, setOpen] = useState(!collapsible);

  return (
    <div className={cn('overflow-hidden rounded-2xl border border-border bg-white shadow-sm', className)}>
      <button
        className={cn('flex w-full items-center justify-between px-4 py-3 text-left', collapsible && 'cursor-pointer transition-colors hover:bg-secondary/30', !collapsible && 'cursor-default')}
        onClick={() => collapsible && setOpen((value) => !value)}
        type="button"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary">
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-foreground">{t(locale, 'System details', 'Detalhes do sistema')}</h3>
            <p className="text-[11px] text-muted-foreground">
              {t(locale, 'Bridge, capture, and token diagnostics', 'Diagnóstico de bridge, captura e token')}
            </p>
          </div>
        </div>
        {collapsible ? open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
      </button>

      {open ? (
        <div className="space-y-1.5 border-t border-border/70 px-4 py-3">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[12px] text-muted-foreground">{t(locale, 'Bridge', 'Bridge')}</span>
            <div className="flex items-center gap-2">
              <StatusDot pulse={bridgeOnline} status={bridgeOnline ? 'online' : 'error'} />
              <span className={cn('text-[12px] font-medium', bridgeOnline ? 'text-emerald-600' : 'text-rose-600')}>
                {bridgeOnline ? t(locale, 'Online', 'Online') : t(locale, 'Offline', 'Offline')}
                {bridgeMode ? <span className="font-normal text-muted-foreground"> · {bridgeMode}</span> : null}
              </span>
            </div>
          </div>

          {diagnostics.tokenSource ? (
            <InlineKv
              label={t(locale, 'Token', 'Token')}
              value={
                <span className="flex items-center gap-1.5">
                  <Key className="h-3 w-3 text-muted-foreground" />
                  {diagnostics.tokenSource}
                </span>
              }
            />
          ) : null}

          {diagnostics.snapshotSource ? (
            <InlineKv
              label={t(locale, 'Snapshot', 'Snapshot')}
              value={
                <span className="flex items-center gap-1.5">
                  <Database className="h-3 w-3 text-muted-foreground" />
                  {diagnostics.snapshotSource}
                </span>
              }
            />
          ) : null}

          {diagnostics.capturedAt ? <InlineKv dim label={t(locale, 'Captured', 'Capturado')} value={formatRelativeTime(locale, diagnostics.capturedAt)} /> : null}
          {diagnostics.lastSentAt ? (
            <InlineKv
              dim
              label={t(locale, 'Sent', 'Enviado')}
              value={
                <span className="flex items-center gap-1.5">
                  <Send className="h-3 w-3 text-muted-foreground" />
                  {formatRelativeTime(locale, diagnostics.lastSentAt)}
                </span>
              }
            />
          ) : null}
          {diagnostics.envId ? <InlineKv dim label={t(locale, 'Env ID', 'ID do ambiente')} mono value={truncate(diagnostics.envId, 18)} /> : null}

          {diagnostics.error ? (
            <div className="mt-2 flex items-start gap-3 rounded-xl bg-rose-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600" />
              <div>
                <p className="text-[12px] font-medium text-rose-600">{t(locale, 'Error', 'Erro')}</p>
                <p className="mt-1 break-all font-mono text-[11px] text-rose-600/80">{diagnostics.error}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
