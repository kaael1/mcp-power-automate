import { Clock, Server, ShieldCheck, Wifi } from 'lucide-react';

import { formatRelativeTime, t, type Locale } from '../../i18n.js';
import type { DashboardModel } from '../../dashboard-model.js';
import { SectionLabel, SignalPill } from './atoms.js';

export function SignalGrid({
  className,
  compact = false,
  locale,
  model,
}: {
  className?: string;
  compact?: boolean;
  locale: Locale;
  model: Pick<DashboardModel, 'bridgeOnline' | 'diagnostics' | 'hasLegacyApi' | 'hasSession'>;
}) {
  const freshness = model.diagnostics.capturedAt
    ? (() => {
        const diff = Date.now() - new Date(model.diagnostics.capturedAt).getTime();
        const min = Math.floor(diff / 60000);
        if (min < 5) return { label: formatRelativeTime(locale, model.diagnostics.capturedAt), ok: true as boolean | null };
        if (min < 30) return { label: formatRelativeTime(locale, model.diagnostics.capturedAt), ok: null as boolean | null };
        return { label: formatRelativeTime(locale, model.diagnostics.capturedAt), ok: false as boolean | null };
      })()
    : { label: '—', ok: null as boolean | null };

  const environment = model.diagnostics.envId
    ? { label: model.diagnostics.envId.slice(0, 12), ok: true as boolean | null }
    : { label: t(locale, 'Not detected yet', 'Ainda não detectado'), ok: null as boolean | null };

  const items = [
    {
      icon: <Wifi className="h-4 w-4" />,
      label: t(locale, 'Local bridge', 'Bridge local'),
      ok: model.bridgeOnline,
      value: model.bridgeOnline ? t(locale, 'Connected', 'Conectada') : t(locale, 'Offline', 'Offline'),
    },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      label: t(locale, 'Action readiness', 'Pronto para agir'),
      ok: model.hasLegacyApi,
      value: model.hasLegacyApi ? t(locale, 'Ready', 'Pronto') : t(locale, 'Needs refresh', 'Precisa atualizar'),
    },
    {
      icon: <Clock className="h-4 w-4" />,
      label: t(locale, 'Latest capture', 'Última captura'),
      ok: freshness.ok,
      value: freshness.label,
    },
    {
      icon: <Server className="h-4 w-4" />,
      label: t(locale, 'Environment', 'Ambiente'),
      ok: environment.ok,
      value: environment.label,
    },
  ];

  const visibleItems = compact ? items.slice(0, 2) : items;

  return (
    <div className={className}>
      <SectionLabel className="mb-2 block">{compact ? t(locale, 'Status', 'Status') : t(locale, 'Trust checks', 'Checagens')}</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {visibleItems.map((item) => (
          <SignalPill className={compact ? 'px-3 py-2.5' : undefined} icon={item.icon} key={item.label} label={item.label} locale={locale} ok={item.ok} value={item.value} />
        ))}
      </div>
    </div>
  );
}
