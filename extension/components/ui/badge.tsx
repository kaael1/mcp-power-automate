import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
  {
    defaultVariants: {
      variant: 'neutral',
    },
    variants: {
      variant: {
        critical: 'border-destructive/20 bg-destructive/10 text-destructive',
        good: 'border-success/20 bg-success/10 text-success',
        neutral: 'border-border bg-muted/70 text-muted-foreground',
        primary: 'border-primary/15 bg-primary/10 text-primary',
        warning: 'border-warning/20 bg-warning/10 text-warning',
      },
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ className, variant }))} {...props} />;
}

export { Badge, badgeVariants };
