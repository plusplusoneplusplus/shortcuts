import { cn } from '../../ui/cn';
import type { PrewarmStatus } from './hooks/usePrewarmClient';

export interface WarmIndicatorDotProps {
    /** Optimistic warm status from {@link usePrewarmClient}. */
    status: PrewarmStatus;
    /** Extra classes for positioning within the toolbar. */
    className?: string;
}

/**
 * Tiny (~6px) optimistic "session warm" indicator shown next to the send button
 * (AC-03). It is a cosmetic, best-effort signal fed solely by
 * {@link usePrewarmClient}'s status:
 *  - `unsupported` → renders **nothing** — providers that can never stay warm
 *    (e.g. Claude) make no false promise;
 *  - `idle`        → a transparent spacer that reserves the dot's footprint so
 *    the send button never shifts as warmth comes and goes;
 *  - `warming`     → a subtle pulsing amber dot;
 *  - `warm`        → a solid green "ready" dot.
 *
 * The wrapper is fixed-size, `pointer-events-none`, and the coloured dot itself
 * is `aria-hidden`, so the indicator can neither relayout the toolbar nor steal
 * the send button's hit target. The `warming`/`warm` states expose an
 * accessible label + native tooltip; `idle` is a silent spacer (nothing to
 * announce).
 */
export function WarmIndicatorDot({ status, className }: WarmIndicatorDotProps) {
    // No dot at all for providers that cannot stay warm — no false promise.
    if (status === 'unsupported') return null;

    // Idle is a quiet, transparent spacer. Keeping its footprint means the send
    // button does not jump left/right when the dot appears (warming/warm) or
    // decays back to idle.
    if (status === 'idle') {
        return (
            <span
                aria-hidden="true"
                data-testid="warm-indicator-dot"
                data-status="idle"
                className={cn('inline-block shrink-0 w-2 h-2 pointer-events-none', className)}
            />
        );
    }

    const label = status === 'warm'
        ? 'Session warm — next reply starts fast'
        : 'Warming…';

    return (
        <span
            data-testid="warm-indicator-dot"
            data-status={status}
            role="img"
            aria-label={label}
            title={label}
            className={cn('inline-flex shrink-0 items-center justify-center w-2 h-2 pointer-events-none', className)}
        >
            <span
                aria-hidden="true"
                className={cn(
                    'block w-1.5 h-1.5 rounded-full',
                    status === 'warm'
                        ? 'bg-[#6a9955] dark:bg-[#89d185]'
                        : 'bg-[#c8a13a] dark:bg-[#d7ba7d] animate-pulse',
                )}
            />
        </span>
    );
}
