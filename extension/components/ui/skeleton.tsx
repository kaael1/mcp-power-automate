import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/utils.js';

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-xl bg-muted/70', className)} {...props} />;
}

export { Skeleton };
