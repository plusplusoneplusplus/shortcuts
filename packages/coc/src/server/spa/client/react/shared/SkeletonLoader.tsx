/**
 * SkeletonLoader — lightweight pulse-shimmer skeleton components for loading states.
 *
 * Usage:
 *   <SkeletonLine />                     // single text line
 *   <SkeletonLine className="w-1/2" />   // shorter line
 *   <SkeletonCard />                     // card-shaped block
 *   <SkeletonList count={5} />           // stack of lines
 *   <SkeletonListItem />                 // row with avatar + two lines
 */

import { cn } from './cn';

interface SkeletonLineProps {
    className?: string;
}

export function SkeletonLine({ className }: SkeletonLineProps) {
    return (
        <div
            className={cn(
                'h-3 rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] animate-pulse',
                className
            )}
            aria-hidden="true"
        />
    );
}

interface SkeletonCardProps {
    className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
    return (
        <div
            className={cn(
                'rounded-md bg-[#e0e0e0] dark:bg-[#3c3c3c] animate-pulse h-20',
                className
            )}
            aria-hidden="true"
        />
    );
}

interface SkeletonListProps {
    /** Number of skeleton rows to render. Default: 5 */
    count?: number;
    className?: string;
}

export function SkeletonList({ count = 5, className }: SkeletonListProps) {
    return (
        <div className={cn('flex flex-col gap-3 px-4 py-3', className)} aria-busy="true" aria-label="Loading…">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                    <SkeletonLine className={i % 3 === 2 ? 'w-2/3' : 'w-full'} />
                    <SkeletonLine className="w-1/2 h-2" />
                </div>
            ))}
        </div>
    );
}

interface SkeletonListItemProps {
    className?: string;
}

/** Row skeleton: left avatar circle + two text lines. */
export function SkeletonListItem({ className }: SkeletonListItemProps) {
    return (
        <div className={cn('flex items-start gap-3 px-4 py-2', className)} aria-hidden="true">
            {/* Avatar placeholder */}
            <div className="w-8 h-8 rounded-full bg-[#e0e0e0] dark:bg-[#3c3c3c] animate-pulse flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <SkeletonLine className="w-3/4" />
                <SkeletonLine className="w-1/2 h-2" />
            </div>
        </div>
    );
}
