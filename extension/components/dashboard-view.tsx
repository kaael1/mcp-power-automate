import { type ChangeEvent, type ReactNode, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Globe2,
  History,
  Languages,
  LayoutList,
  Shield,
  Workflow,
} from 'lucide-react';

import type { HealthPayload } from '../../server/bridge-types.js';
import type { DashboardModel } from '../dashboard-model.js';
import { LOCALE_OPTIONS, t, type Locale } from '../i18n.js';
import { cn } from '../lib/utils.js';
import type { DashboardAction } from '../use-dashboard.js';
import { AccessScopeBadge, PinBadge, SectionLabel, StatusDot } from './pa/atoms.js';
import { AttentionBannerSingle, AttentionItemRow, LastRunCard, LastUpdateCard } from './pa/cards.js';
import { DiagnosticsBlock } from './pa/diagnostics.js';
import { FlowRefRow } from './pa/flow-ref.js';
import { LastUpdateReview } from './pa/review.js';
import { SignalGrid } from './pa/signal-grid.js';
import { Input } from './ui/input.js';
import { Skeleton } from './ui/skeleton.js';

export type SidePanelSection = 'flows' | 'review' | 'system' | 'today';

type Surface = 'popup' | 'sidepanel';

const truncate = (value: string | null | undefined, max: number) => {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

const getDisplayedTarget = (model: DashboardModel) => model.activeTarget || model.currentTab || null;

const getActionableAttention = (model: Pick<DashboardModel, 'attentionItems'>) =>
  model.attentionItems.filter((item) => item.severity !== 'success');

function LocaleToggle({
  locale,
  onLocaleChange,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background p-1">
      {LOCALE_OPTIONS.map((option) => (
        <button
          aria-label={option.id === 'en' ? 'Switch language to English' : 'Mudar idioma para português do Brasil'}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors',
            locale === option.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary',
          )}
          key={option.id}
          onClick={() => onLocaleChange(option.id)}
          type="button"
        >
          <span aria-hidden="true" className="text-xs leading-none">
            {option.flag}
          </span>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PopupHeader({
  locale,
  model,
  onLocaleChange,
}: {
  locale: Locale;
  model: Pick<DashboardModel, 'attentionItems' | 'bridgeOnline' | 'statusLabel' | 'statusMessage'>;
  onLocaleChange: (locale: Locale) => void;
}) {
  const actionableCount = getActionableAttention(model).length;

  return (
    <div className="rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PA cockpit</p>
          <div className="mt-1 flex items-center gap-2">
            <StatusDot pulse={model.bridgeOnline} status={model.bridgeOnline ? 'online' : actionableCount > 0 ? 'warning' : 'offline'} />
            <h1 className="text-[15px] font-semibold text-foreground">{model.statusLabel}</h1>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{model.statusMessage}</p>
        </div>
        <LocaleToggle locale={locale} onLocaleChange={onLocaleChange} />
      </div>
    </div>
  );
}

function EmptyStateCard({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: React.ElementType;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white px-4 py-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function CurrentFlowPanel({
  locale,
  model,
}: {
  locale: Locale;
  model: DashboardModel;
}) {
  const selectedTarget = getDisplayedTarget(model);
  const showTabMismatch = Boolean(model.selectedTargetMismatch && model.currentTab);

  if (!selectedTarget) {
    return (
      <EmptyStateCard
        description={t(
          locale,
          'Open a Power Automate flow page so the extension can capture the right context.',
          'Abra uma página de fluxo do Power Automate para a extensão capturar o contexto correto.',
        )}
        icon={Workflow}
        title={t(locale, 'No flow selected', 'Nenhum fluxo selecionado')}
      />
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Workflow className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <SectionLabel>{t(locale, 'Selected target', 'Fluxo selecionado')}</SectionLabel>
          <p className="mt-1 truncate text-[14px] font-semibold text-foreground">{selectedTarget.displayName}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{truncate(selectedTarget.flowId, 28)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <AccessScopeBadge locale={locale} scope={selectedTarget.accessScope} />
            <PinBadge locale={locale} pinned={selectedTarget.isPinned} />
          </div>
        </div>
      </div>

      {showTabMismatch ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                {t(locale, 'Browser tab', 'Aba atual')}
              </p>
              <p className="mt-1 truncate text-[13px] font-medium text-amber-900">{model.currentTab?.displayName}</p>
              <p className="mt-1 text-[12px] text-amber-800/80">
                {t(
                  locale,
                  'The open tab is different from the selected target.',
                  'A aba aberta está diferente do fluxo selecionado.',
                )}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RecentActivityPanel({
  className,
  locale,
  model,
}: {
  className?: string;
  locale: Locale;
  model: DashboardModel;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <SectionLabel>{t(locale, 'Recent activity', 'Atividade recente')}</SectionLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <LastRunCard locale={locale} run={model.lastRun} />
        <LastUpdateCard locale={locale} update={model.lastUpdate} />
      </div>
    </div>
  );
}

function PopupDashboard({
  locale,
  model,
  onAction,
  onLocaleChange,
}: {
  locale: Locale;
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
  onLocaleChange: (locale: Locale) => void;
}) {
  const topAttention = getActionableAttention(model)[0] || null;

  return (
    <div className="flex w-[432px] min-h-[560px] max-h-[640px] flex-col bg-background font-sans text-foreground">
      <div className="flex flex-col gap-3 p-4">
        <PopupHeader locale={locale} model={model} onLocaleChange={onLocaleChange} />
        <CurrentFlowPanel locale={locale} model={model} />
        {topAttention ? (
          <AttentionBannerSingle
            item={topAttention}
            onAction={() => (topAttention.actionType ? onAction({ type: topAttention.actionType }) : undefined)}
          />
        ) : null}
        <RecentActivityPanel locale={locale} model={model} />
        <DiagnosticsBlock
          bridgeMode={model.bridgeMode}
          bridgeOnline={model.bridgeOnline}
          collapsible
          diagnostics={model.diagnostics}
          locale={locale}
        />
      </div>
    </div>
  );
}

function SidePanelSidebar({
  activeSection,
  locale,
  model,
  onSectionChange,
}: {
  activeSection: SidePanelSection;
  locale: Locale;
  model: DashboardModel;
  onSectionChange: (section: SidePanelSection) => void;
}) {
  const navItems: Array<{ icon: React.ElementType; id: SidePanelSection; label: string }> = [
    { icon: Shield, id: 'today', label: t(locale, 'Today', 'Hoje') },
    { icon: LayoutList, id: 'flows', label: t(locale, 'Flows', 'Fluxos') },
    { icon: History, id: 'review', label: t(locale, 'Review', 'Revisão') },
    { icon: Globe2, id: 'system', label: t(locale, 'System', 'Sistema') },
  ];
  const selectedTarget = getDisplayedTarget(model);
  const actionableCount = getActionableAttention(model).length;

  return (
    <aside className="flex h-full w-[224px] flex-shrink-0 flex-col border-r border-border bg-[#f4f7fb] px-4 py-4">
      <div className="rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PA cockpit</p>
        <div className="mt-2 flex items-center gap-2">
          <StatusDot pulse={model.bridgeOnline} status={model.bridgeOnline ? 'online' : actionableCount > 0 ? 'warning' : 'offline'} />
          <p className="text-[14px] font-semibold text-foreground">{model.statusLabel}</p>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{truncate(model.statusMessage, 120)}</p>
      </div>

      <div className="mt-3 rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
        <SectionLabel>{t(locale, 'Selected target', 'Fluxo selecionado')}</SectionLabel>
        <p className="mt-1 truncate text-[13px] font-medium text-foreground">
          {selectedTarget?.displayName ?? t(locale, 'No flow selected', 'Nenhum fluxo selecionado')}
        </p>
      </div>

      <nav className="mt-4 flex flex-col gap-1.5">
        {navItems.map(({ icon: Icon, id, label }) => (
          <button
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors',
              activeSection === id ? 'bg-foreground text-background' : 'text-foreground hover:bg-white',
            )}
            key={id}
            onClick={() => onSectionChange(id)}
            type="button"
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{label}</span>
            {id === 'today' && actionableCount > 0 ? (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {actionableCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function TodaySection({
  locale,
  model,
  onAction,
}: {
  locale: Locale;
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
}) {
  const actionableItems = getActionableAttention(model);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t(locale, 'Today', 'Hoje')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{model.statusMessage}</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <CurrentFlowPanel locale={locale} model={model} />

          {actionableItems.length > 0 ? (
            <div className="space-y-2">
              <SectionLabel>
                {t(locale, `Needs attention (${actionableItems.length})`, `Requer atenção (${actionableItems.length})`)}
              </SectionLabel>
              <div className="space-y-2">
                {actionableItems.map((item) => (
                  <AttentionItemRow
                    item={item}
                    key={item.id}
                    locale={locale}
                    onAction={() => (item.actionType ? onAction({ type: item.actionType }) : undefined)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyStateCard
              description={t(
                locale,
                'The selected target, browser session, and latest checks are aligned.',
                'O fluxo selecionado, a sessão do navegador e as últimas checagens estão alinhados.',
              )}
              icon={CheckCircle2}
              title={t(locale, 'Everything looks ready', 'Tudo parece pronto')}
            />
          )}
        </div>

        <div className="space-y-4">
          <SignalGrid locale={locale} model={model} />
          <RecentActivityPanel locale={locale} model={model} />
        </div>
      </div>
    </div>
  );
}

function FlowsSection({
  locale,
  model,
}: {
  locale: Locale;
  model: DashboardModel;
}) {
  const [search, setSearch] = useState('');
  const filteredCatalog = useMemo(
    () => model.catalogFlows.filter((flow) => flow.displayName.toLowerCase().includes(search.toLowerCase())),
    [model.catalogFlows, search],
  );
  const activeFlowId = model.activeTarget?.flowId || model.currentTab?.flowId || null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-4 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t(locale, 'Flows', 'Fluxos')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {model.flowCatalogMessage ??
              t(
                locale,
                'Browse the environment catalog and retarget the extension when needed.',
                'Navegue pelo catálogo do ambiente e redefina o fluxo quando precisar.',
              )}
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Input
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
            placeholder={t(locale, 'Search flows...', 'Buscar fluxos...')}
            value={search}
          />
        </div>
      </div>

      {(model.pinnedFlows.length > 0 || model.recentFlows.length > 0) && !search ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {model.pinnedFlows.length > 0 ? (
            <div className="space-y-2">
              <SectionLabel>{t(locale, 'Pinned', 'Fixados')}</SectionLabel>
              <div className="space-y-2">
                {model.pinnedFlows.map((flow) => (
                  <FlowRefRow
                    flow={flow}
                    isActive={activeFlowId === flow.flowId}
                    key={flow.flowId}
                    locale={locale}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {model.recentFlows.length > 0 ? (
            <div className="space-y-2">
              <SectionLabel>{t(locale, 'Recent', 'Recentes')}</SectionLabel>
              <div className="space-y-2">
                {model.recentFlows.map((flow) => (
                  <FlowRefRow
                    flow={flow}
                    isActive={activeFlowId === flow.flowId}
                    key={flow.flowId}
                    locale={locale}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <SectionLabel>{t(locale, `All flows (${filteredCatalog.length})`, `Todos os fluxos (${filteredCatalog.length})`)}</SectionLabel>
        <div className="space-y-2">
          {filteredCatalog.length === 0 ? (
            <EmptyStateCard
              description={t(locale, 'Try a different search term.', 'Tente um termo de busca diferente.')}
              icon={LayoutList}
              title={t(locale, 'No matching flows', 'Nenhum fluxo encontrado')}
            />
          ) : (
            filteredCatalog.map((flow) => (
              <FlowRefRow
                flow={{
                  accessScope: flow.accessScope,
                  displayName: flow.displayName,
                  envId: flow.envId,
                  flowId: flow.flowId,
                  isPinned: model.pinnedFlows.some((item) => item.flowId === flow.flowId),
                  isRecent: model.recentFlows.some((item) => item.flowId === flow.flowId),
                }}
                isActive={activeFlowId === flow.flowId}
                key={flow.flowId}
                locale={locale}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function ReviewSection({
  locale,
  model,
}: {
  locale: Locale;
  model: DashboardModel;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t(locale, 'Review', 'Revisão')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              locale,
              'Inspect the latest saved change before editing again.',
              'Inspecione a última mudança salva antes de editar novamente.',
            )}
          </p>
        </div>
      </div>

      {model.lastUpdate ? (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <CurrentFlowPanel locale={locale} model={model} />
            <LastUpdateCard locale={locale} update={model.lastUpdate} />
          </div>
          <LastUpdateReview locale={locale} update={model.lastUpdate} />
        </div>
      ) : (
        <EmptyStateCard
          description={t(
            locale,
            'A detailed review appears here after the extension captures a saved change.',
            'Uma revisão detalhada aparece aqui depois que a extensão captura uma mudança salva.',
          )}
          icon={History}
          title={t(locale, 'No cached change review', 'Nenhuma revisão em cache')}
        />
      )}
    </div>
  );
}

export function SystemSection({
  locale,
  model,
  onLocaleChange,
}: {
  locale: Locale;
  model: DashboardModel;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t(locale, 'System', 'Sistema')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            locale,
            'Technical details stay here so the main workspace can stay focused.',
            'Os detalhes técnicos ficam aqui para o espaço principal continuar focado.',
          )}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-foreground">
              <Languages className="h-4 w-4" />
            </div>
            <div>
              <SectionLabel>{t(locale, 'Language', 'Idioma')}</SectionLabel>
              <p className="mt-1 text-[13px] font-medium text-foreground">
                {t(locale, 'Interface language', 'Idioma da interface')}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <LocaleToggle locale={locale} onLocaleChange={onLocaleChange} />
          </div>
        </div>

        <SignalGrid locale={locale} model={model} />
      </div>

      <DiagnosticsBlock
        bridgeMode={model.bridgeMode}
        bridgeOnline={model.bridgeOnline}
        collapsible={false}
        diagnostics={model.diagnostics}
        locale={locale}
      />
    </div>
  );
}

export function PopupDashboardView({
  locale,
  model,
  onAction,
  onLocaleChange,
}: {
  locale: Locale;
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
  onLocaleChange: (locale: Locale) => void;
}) {
  return <PopupDashboard locale={locale} model={model} onAction={onAction} onLocaleChange={onLocaleChange} />;
}

export function SidePanelDashboardView({
  initialSection = 'today',
  locale,
  model,
  onAction,
  onLocaleChange,
}: {
  initialSection?: SidePanelSection;
  locale: Locale;
  model: DashboardModel;
  onAction: (action: DashboardAction) => void;
  onLocaleChange: (locale: Locale) => void;
}) {
  const [activeSection, setActiveSection] = useState<SidePanelSection>(initialSection);

  const sections: Record<SidePanelSection, ReactNode> = {
    flows: <FlowsSection locale={locale} model={model} />,
    review: <ReviewSection locale={locale} model={model} />,
    system: <SystemSection locale={locale} model={model} onLocaleChange={onLocaleChange} />,
    today: <TodaySection locale={locale} model={model} onAction={onAction} />,
  };

  return (
    <div className="flex h-full min-h-[600px] w-full overflow-hidden bg-background font-sans text-foreground">
      <SidePanelSidebar activeSection={activeSection} locale={locale} model={model} onSectionChange={setActiveSection} />
      <main className="min-w-0 flex-1 overflow-y-auto p-5">{sections[activeSection]}</main>
    </div>
  );
}

export function LoadingView({
  locale,
  onLocaleChange,
  surface,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  surface: Surface;
}) {
  return (
    <div className={cn(surface === 'sidepanel' ? 'p-5' : 'w-[432px] p-4')}>
      <div className="space-y-3">
        <div className="flex justify-end">
          <LocaleToggle locale={locale} onLocaleChange={onLocaleChange} />
        </div>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    </div>
  );
}

export function ErrorView({
  bridgeHealth,
  error,
  locale,
  onLocaleChange,
  surface,
}: {
  bridgeHealth: HealthPayload | null;
  error: string;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onRetry: () => void;
  surface: Surface;
}) {
  return (
    <div className={cn(surface === 'sidepanel' ? 'p-5' : 'w-[432px] p-4')}>
      <div className="space-y-3">
        <div className="flex justify-end">
          <LocaleToggle locale={locale} onLocaleChange={onLocaleChange} />
        </div>
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                {t(locale, 'Connection issue', 'Problema de conexão')}
              </p>
              <h2 className="mt-1 text-base font-semibold text-foreground">
                {t(locale, 'Could not open the extension workspace.', 'Não foi possível abrir o espaço da extensão.')}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{error}</p>
            </div>
            <div className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-600">
              {bridgeHealth?.ok ? t(locale, 'Bridge ok', 'Bridge ok') : t(locale, 'Bridge offline', 'Bridge offline')}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
