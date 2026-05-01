import type { ElementType } from 'react';
import { Link2, PanelRightOpen, RefreshCcw, RotateCcw } from 'lucide-react';

import { t, type Locale } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import type { DashboardAction } from '../../use-dashboard.js';
import { Button } from '../ui/button.js';

function ActionButton({
  className,
  disabled,
  icon: Icon,
  label,
  onClick,
  variant = 'secondary',
}: {
  className?: string;
  disabled?: boolean;
  icon: ElementType;
  label: string;
  onClick?: () => void;
  variant?: 'default' | 'ghost' | 'outline' | 'secondary';
}) {
  return (
    <Button className={cn('h-10 gap-2 rounded-xl text-[13px]', className)} disabled={disabled} onClick={onClick} size="sm" variant={variant}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

export function ActionGroup({
  canUseCurrentTab,
  hasLastUpdate,
  hasSession,
  includeOpenPanel,
  locale,
  onAction,
  pendingAction,
}: {
  canUseCurrentTab?: boolean;
  hasLastUpdate?: boolean;
  hasSession?: boolean;
  includeOpenPanel?: boolean;
  locale: Locale;
  onAction: (action: DashboardAction) => void;
  pendingAction?: string | null;
}) {
  type ActionItem = {
    actionType: string;
    icon: ElementType;
    label: string;
    onClick: () => void;
    variant: 'default' | 'outline' | 'secondary';
  };

  const actions: ActionItem[] = [];

  if (includeOpenPanel) {
    actions.push({
      actionType: 'open-side-panel',
      icon: PanelRightOpen,
      label: t(locale, 'Open workspace', 'Abrir painel'),
      onClick: () => onAction({ type: 'open-side-panel' }),
      variant: 'default',
    });
  }

  if (canUseCurrentTab) {
    actions.push({
      actionType: 'select-work-tab',
      icon: Link2,
      label: t(locale, 'Use as work tab', 'Usar como aba de trabalho'),
      onClick: () => onAction({ type: 'select-work-tab' }),
      variant: includeOpenPanel ? 'secondary' : 'default',
    });
  }

  if (hasSession) {
    actions.push({
      actionType: 'refresh-last-run',
      icon: RefreshCcw,
      label: t(locale, 'Refresh run', 'Atualizar execução'),
      onClick: () => onAction({ type: 'refresh-last-run' }),
      variant: 'secondary',
    });
  }

  if (hasLastUpdate) {
    actions.push({
      actionType: 'revert-last-update',
      icon: RotateCcw,
      label: t(locale, 'Undo change', 'Desfazer'),
      onClick: () => onAction({ type: 'revert-last-update' }),
      variant: 'outline',
    });
  }

  if (actions.length === 0) return null;

  const isAnyPending = Boolean(pendingAction);

  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((action) => (
        <ActionButton
          className={actions.length === 1 ? 'col-span-2' : undefined}
          disabled={isAnyPending}
          icon={action.icon}
          key={action.label}
          label={pendingAction === action.actionType ? `${action.label}…` : action.label}
          onClick={action.onClick}
          variant={action.variant}
        />
      ))}
    </div>
  );
}
