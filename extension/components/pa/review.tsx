import { CheckCircle2, FileDiff, GitCommitHorizontal, Plus, Trash2 } from 'lucide-react';

import type { LastUpdate } from '../../../server/schemas.js';
import { t, type Locale } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { SectionLabel, TimeAgo } from './atoms.js';

const sectionOrder = ['metadata', 'triggers', 'actions', 'connections', 'other'] as const;

const sectionLabel = (locale: Locale, id: (typeof sectionOrder)[number]) => {
  switch (id) {
    case 'metadata':
      return t(locale, 'Flow details', 'Detalhes do fluxo');
    case 'triggers':
      return t(locale, 'Triggers', 'Triggers');
    case 'actions':
      return t(locale, 'Actions', 'A\u00e7\u00f5es');
    case 'connections':
      return t(locale, 'Connections', 'Conex\u00f5es');
    case 'other':
      return t(locale, 'Other definition changes', 'Outras mudan\u00e7as na defini\u00e7\u00e3o');
  }
};

const changeLabel = (locale: Locale, changeType: 'added' | 'modified' | 'removed') => {
  switch (changeType) {
    case 'added':
      return t(locale, 'Added', 'Adicionado');
    case 'removed':
      return t(locale, 'Removed', 'Removido');
    case 'modified':
      return t(locale, 'Modified', 'Alterado');
  }
};

const changeIcon = (changeType: 'added' | 'modified' | 'removed') => {
  switch (changeType) {
    case 'added':
      return Plus;
    case 'removed':
      return Trash2;
    case 'modified':
      return FileDiff;
  }
};

const changeTone = (changeType: 'added' | 'modified' | 'removed') => {
  switch (changeType) {
    case 'added':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'removed':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'modified':
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
};

const stringifyPreview = (value: unknown) => {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

function ValuePreview({
  label,
  tone,
  value,
}: {
  label: string;
  tone: 'after' | 'before';
  value: unknown;
}) {
  const preview = stringifyPreview(value);
  if (!preview) return null;

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        tone === 'before' ? 'border-slate-200 bg-slate-50/80' : 'border-emerald-200 bg-emerald-50/70',
      )}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {preview}
      </pre>
    </div>
  );
}

function ReviewItemCard({
  item,
  locale,
}: {
  item: NonNullable<LastUpdate['review']>['sections'][number]['items'][number];
  locale: Locale;
}) {
  const Icon = changeIcon(item.changeType);

  return (
    <div className="rounded-2xl border border-border bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold', changeTone(item.changeType))}>
              <Icon className="h-3 w-3" />
              {changeLabel(locale, item.changeType)}
            </span>
            <h5 className="text-[13px] font-semibold text-foreground">{item.label}</h5>
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">{item.path}</p>
        </div>
      </div>

      {(item.beforeValue !== undefined || item.afterValue !== undefined) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {item.beforeValue !== undefined ? <ValuePreview label={t(locale, 'Before', 'Antes')} tone="before" value={item.beforeValue} /> : null}
          {item.afterValue !== undefined ? <ValuePreview label={t(locale, 'After', 'Depois')} tone="after" value={item.afterValue} /> : null}
        </div>
      )}
    </div>
  );
}

function ReviewSectionCard({
  locale,
  section,
}: {
  locale: Locale;
  section: NonNullable<LastUpdate['review']>['sections'][number];
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-[13px] font-semibold text-foreground">{sectionLabel(locale, section.id)}</h4>
          <p className="text-[11px] text-muted-foreground">
            {t(locale, `${section.items.length} exact changes`, `${section.items.length} mudan\u00e7as exatas`)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {section.items.map((item) => (
          <ReviewItemCard item={item} key={item.id} locale={locale} />
        ))}
      </div>
    </div>
  );
}

export function LastUpdateReview({
  className,
  locale,
  update,
}: {
  className?: string;
  locale: Locale;
  update: LastUpdate | null;
}) {
  if (!update) {
    return null;
  }

  const review = update.review;

  if (!review?.summary || !Array.isArray(review.sections)) {
    return null;
  }

  const changedSections = review.summary.changedSectionIds;
  const unchangedSections = review.summary.unchangedSectionIds;
  const totalChanges = review.summary.totalChanges;

  return (
    <div className={cn('rounded-2xl border border-border bg-white p-4 shadow-sm', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <SectionLabel>{t(locale, 'Change review', 'Revis\u00e3o da mudan\u00e7a')}</SectionLabel>
          <h3 className="mt-1 text-[15px] font-semibold text-foreground">
            {t(locale, 'Exactly what changed in the flow', 'Exatamente o que mudou no fluxo')}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          {t(locale, `${totalChanges} changes`, `${totalChanges} mudan\u00e7as`)}
        </span>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-secondary/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(locale, 'Captured', 'Capturada')}</p>
          <div className="mt-2">
            <TimeAgo date={update.capturedAt} locale={locale} />
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-secondary/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(locale, 'Changed sections', 'Se\u00e7\u00f5es alteradas')}</p>
          <p className="mt-2 text-[12px] font-medium text-foreground">
            {changedSections.map((sectionId) => sectionLabel(locale, sectionId)).join(', ')}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-secondary/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(locale, 'No other changes in', 'Sem outras mudan\u00e7as em')}</p>
          <p className="mt-2 text-[12px] font-medium text-foreground">
            {unchangedSections.length > 0
              ? unchangedSections.map((sectionId) => sectionLabel(locale, sectionId)).join(', ')
              : t(locale, 'Every tracked section changed', 'Toda se\u00e7\u00e3o monitorada mudou')}
          </p>
        </div>
      </div>

      <div className="mb-4 rounded-[18px] border border-emerald-200 bg-emerald-50/80 p-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-700" />
          <p className="text-[12px] leading-relaxed text-emerald-900">
            {t(
              locale,
              'Use this review to confirm the assistant touched only the parts below. Anything listed as unchanged stayed outside the saved diff.',
              'Use esta revis\u00e3o para confirmar que o assistente tocou apenas nas partes abaixo. Tudo que aparece como n\u00e3o alterado ficou fora do diff salvo.',
            )}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {sectionOrder
          .map((sectionId) => review.sections.find((section) => section.id === sectionId))
          .filter((section): section is NonNullable<typeof section> => Boolean(section))
          .map((section) => (
            <ReviewSectionCard key={section.id} locale={locale} section={section} />
          ))}
      </div>
    </div>
  );
}
