import { cn } from '../../ui/cn';
import type { WarmClientStatus } from './hooks/useWarmClientStatus';

export interface WarmIndicatorDotProps {
    /** Stream-derived warm status from {@link useWarmClientStatus}. */
    status: WarmClientStatus;
    /** Extra classes for positioning within the toolbar. */
    className?: string;
}

/**
 * Tiny (~6px) "session warm" indicator shown next to the send button (AC-02).
 * It is a cosmetic signal fed solely by {@link useWarmClientStatus}'s SSE-pushed
 * status, which mirrors the backend `WarmClientRegistry`:
 *  - `cold`            → a transparent spacer that reserves the dot's footprint
 *    so the send button never shifts as warmth comes and goes. Providers that
 *    never stay warm (e.g. Claude) stay permanently cold, so their indicator is
 *    always this invisible spacer — no false promise;
 *  - `warming`         → a subtle pulsing amber dot;
 *  - `warm` / `active` → a solid green "ready" dot.
 *
 * The wrapper is fixed-size, `pointer-events-none`, and the coloured dot itself
 * is `aria-hidden`, so the indicator can neither relayout the toolbar nor steal
 * the send button's hit target. The `warming`/`warm`/`active` states expose an
 * accessible label + native tooltip; `cold` is a silent spacer (nothing to
 * announce).
 */
export function WarmIndicatorDot({ status, className }: WarmIndicatorDotProps) {
    // Cold is a quiet, transparent spacer. Keeping its footprint means the send
    // button does not jump left/right when the dot appears (warming/warm/active)
    // or fades back to cold. Permanently-cold providers (Claude) live here too.
    if (status === 'cold') {
        return (
            <span
                aria-hidden="true"
                data-testid="warm-indicator-dot"
                data-status="cold"
                className={cn('inline-block shrink-0 w-2 h-2 pointer-events-none', className)}
            />
        );
    }

    // `warm` (parked, ready) and `active` (a turn already in flight on a live
    // client) both mean the next reply starts fast → the same green "ready" dot.
    const isReady = status === 'warm' || status === 'active';
    const label = isReady
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
                    isReady
                        ? 'bg-[#6a9955] dark:bg-[#89d185]'
                        : 'bg-[#c8a13a] dark:bg-[#d7ba7d] animate-pulse',
                )}
            />
        </span>
    );
}
