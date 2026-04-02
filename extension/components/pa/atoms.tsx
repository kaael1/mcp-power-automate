import { type ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Pin,
  X,
} from 'lucide-react';

import type { DashboardAttentionItem, DashboardFlowReference } from '../../dashboard-model.js';
import { formatRelativeTime, t, type Locale } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

type Severity = DashboardAttentionItem['severity'];
type AccessScope = DashboardFlowReference['accessScope'];

interface StatusPillProps {
  className?: string;
  label: string;
  status: 'error' | 'info' | 'neutral' | 'running' | 'success' | 'warning';
}

const statusConfig = {
  error: {
    bg: 'bg-rose-50',
    icon: X,
    text: 'text-rose-600',
  },
  info: {
    bg: 'bg-blue-50',
    icon: Info,
    text: 'text-blue-600',
  },
  neutral: {
    bg: 'bg-secondary',
    icon: Info,
    text: 'text-muted-foreground',
  },
  running: {
    bg: 'bg-violet-50',
    icon: Loader2,
    text: 'text-violet-600',
  },
  success: {
    bg: 'bg-emerald-50',
    icon: CheckCircle2,
    text: 'text-emerald-600',
  },
  warning: {
    bg: 'bg-amber-50',
    icon: AlertTriangle,
    text: 'text-amber-600',
  },
} as const;

export function StatusPill({ className, label, status }: StatusPillProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', config.bg, config.text, className)}>
      <Icon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} />
      {label}
    </span>
  );
}

interface SeverityBadgeProps {
  className?: string;
  label?: string;
  locale: Locale;
  severity: Severity;
}

const severityConfig: Record<Severity, { bg: string; icon: typeof AlertCircle; text: string }> = {
  critical: {
    bg: 'bg-rose-50',
    icon: AlertCircle,
    text: 'text-rose-600',
  },
  info: {
    bg: 'bg-blue-50',
    icon: Info,
    text: 'text-blue-600',
  },
  success: {
    bg: 'bg-emerald-50',
    icon: CheckCircle2,
    text: 'text-emerald-600',
  },
  warning: {
    bg: 'bg-amber-50',
    icon: AlertTriangle,
    text: 'text-amber-600',
  },
};

export function SeverityBadge({ className, label, locale, severity }: SeverityBadgeProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;

  const defaultLabels: Record<Severity, string> = {
    critical: t(locale, 'Critical', 'Crítico'),
    info: t(locale, 'Info', 'Info'),
    success: t(locale, 'Ready', 'Pronto'),
    warning: t(locale, 'Heads up', 'Atenção'),
  };

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', config.bg, config.text, className)}>
      <Icon className="h-3 w-3" />
      {label ?? defaultLabels[severity]}
    </span>
  );
}

interface RunStatusBadgeProps {
  className?: string;
  locale: Locale;
  status: string | null | undefined;
}

export function RunStatusBadge({ className, locale, status }: RunStatusBadgeProps) {
  if (!status) return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;

  const runStatusMap: Record<string, { label: string; status: StatusPillProps['status'] }> = {
    cancelled: { label: t(locale, 'Cancelled', 'Cancelado'), status: 'neutral' },
    failed: { label: t(locale, 'Failed', 'Falhou'), status: 'error' },
    failure: { label: t(locale, 'Failed', 'Falhou'), status: 'error' },
    inprogress: { label: t(locale, 'Running', 'Em execução'), status: 'running' },
    running: { label: t(locale, 'Running', 'Em execução'), status: 'running' },
    success: { label: t(locale, 'Succeeded', 'Sucesso'), status: 'success' },
    succeeded: { label: t(locale, 'Succeeded', 'Sucesso'), status: 'success' },
    waiting: { label: t(locale, 'Waiting', 'Aguardando'), status: 'info' },
  };

  const config = runStatusMap[status.toLowerCase()] ?? { label: status, status: 'neutral' as const };
  return <StatusPill className={className} label={config.label} status={config.status} />;
}

interface StatusDotProps {
  className?: string;
  online?: boolean;
  pulse?: boolean;
  status?: 'error' | 'offline' | 'online' | 'warning';
}

const dotColors = {
  error: 'bg-rose-500',
  offline: 'bg-zinc-400',
  online: 'bg-emerald-500',
  warning: 'bg-amber-500',
} as const;

export function StatusDot({ className, online, pulse = false, status }: StatusDotProps) {
  const resolvedStatus = status ?? (online ? 'online' : 'offline');

  return (
    <span className={cn('relative flex h-2 w-2', className)}>
      {pulse ? <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', dotColors[resolvedStatus])} /> : null}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', dotColors[resolvedStatus])} />
    </span>
  );
}

interface SignalPillProps {
  className?: string;
  icon?: ReactNode;
  label: string;
  locale: Locale;
  ok: boolean | null;
  value?: string;
}

export function SignalPill({ className, icon, label, locale, ok, value }: SignalPillProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors',
        ok === true
          ? 'border-emerald-200 bg-emerald-50/70'
          : ok === false
            ? 'border-rose-200 bg-rose-50/70'
            : 'border-border bg-white',
        className,
      )}
    >
      {icon ? (
        <span className={cn(ok === true ? 'text-emerald-600' : ok === false ? 'text-rose-600' : 'text-muted-foreground')}>
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('text-[13px] font-semibold', ok === true ? 'text-emerald-600' : ok === false ? 'text-rose-600' : 'text-foreground')}>
          {value ?? (ok === true ? t(locale, 'Ready', 'Pronto') : ok === false ? t(locale, 'Offline', 'Offline') : '—')}
        </p>
      </div>
      <StatusDot pulse={ok === true} status={ok === true ? 'online' : ok === false ? 'error' : 'offline'} />
    </div>
  );
}

interface AccessScopeBadgeProps {
  className?: string;
  locale: Locale;
  scope: AccessScope;
}

export function AccessScopeBadge({ className, locale, scope }: AccessScopeBadgeProps) {
  if (!scope) return null;

  const scopeConfig: Record<string, { className: string; label: string }> = {
    owned: { className: 'bg-blue-50 text-blue-600', label: t(locale, 'Owned by me', 'Meu') },
    'portal-shared': { className: 'bg-zinc-100 text-zinc-600', label: t(locale, 'Portal shared', 'Portal') },
    'shared-user': { className: 'bg-violet-50 text-violet-600', label: t(locale, 'Shared with me', 'Compartilhado') },
  };

  const config = scopeConfig[scope] ?? { className: 'bg-secondary text-muted-foreground', label: scope };

  return <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', config.className, className)}>{config.label}</span>;
}

export function PinBadge({ className, locale, pinned }: { className?: string; locale: Locale; pinned?: boolean }) {
  if (!pinned) return null;

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600', className)}>
      <Pin className="h-3 w-3" />
      {t(locale, 'Pinned', 'Fixado')}
    </span>
  );
}

export function InlineKv({
  className,
  dim,
  label,
  mono,
  value,
}: {
  className?: string;
  dim?: boolean;
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1.5', className)}>
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={cn('truncate text-right text-[12px]', mono ? 'font-mono' : 'font-medium', dim ? 'text-muted-foreground' : 'text-foreground')}>
        {value}
      </span>
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground', className)}>{children}</h3>;
}

export function TimeAgo({
  className,
  date,
  locale,
}: {
  className?: string;
  date: Date | string | null | undefined;
  locale: Locale;
}) {
  if (!date) return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <Clock className="h-3 w-3" />
      {formatRelativeTime(locale, date)}
    </span>
  );
}
