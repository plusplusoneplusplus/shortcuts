/**
 * ChatStatusPill — pill-shaped status indicator with a coloured dot, the
 * status label, and (optionally) the duration.
 *
 * Visual contract follows the OpenDesign chat-header reference:
 *   `• Completed · 5h 37m`
 *
 * Drives the same status palette as the legacy `Badge` component but renders
 * as a rounded-full bordered pill with a leading dot. The dot pulses while
 * the run is in flight (running / cancelling).
 */

import { cn } from '../../ui/cn';
import { formatDuration, statusLabel } from '../../utils/format';

export interface ChatStatusPillProps {
    /** Process status: `running`, `queued`, `completed`, `failed`, `cancelled`, `cancelling`. */
    status: string;
    /** Optional process type — affects the displayed label (e.g. workflow vs chat). */
    type?: string;
    /** Run duration in milliseconds. When provided, rendered after the status label. */
    durationMs?: number | null;
    /** When false, only the dot + label render (no duration suffix). Defaults to true. */
    showDuration?: boolean;
    /** When true (narrow tier), only the dot + icon render. */
    iconOnly?: boolean;
    className?: string;
    'data-testid'?: string;
}

interface StatusVariant {
    /** Tailwind classes for the pill border + background tint. */
    pill: string;
    /** Tailwind classes for the leading dot. */
    dot: string;
    /** When true, the dot animates pulsing (active runs). */
    pulse?: boolean;
}

const VARIANT: Record<string, StatusVariant> = {
    running: {
        pill: 'border-[#0078d4]/40 bg-[#0078d4]/10 text-[#0078d4] dark:text-[#3794ff]',
        dot: 'bg-[#0078d4] dark:bg-[#3794ff]',
        pulse: true,
    },
    cancelling: {
        pill: 'border-[#0078d4]/40 bg-[#0078d4]/10 text-[#0078d4] dark:text-[#3794ff]',
        dot: 'bg-[#0078d4] dark:bg-[#3794ff]',
        pulse: true,
    },
    queued: {
        pill: 'border-[#848484]/30 bg-[#848484]/10 text-[#5a5a5a] dark:text-[#cccccc]',
        dot: 'bg-[#848484]',
    },
    completed: {
        pill: 'border-[#16825d]/30 bg-[#16825d]/10 text-[#16825d] dark:text-[#89d185]',
        dot: 'bg-[#16825d] dark:bg-[#89d185]',
    },
    failed: {
        pill: 'border-[#f14c4c]/30 bg-[#f14c4c]/10 text-[#f14c4c] dark:text-[#f48771]',
        dot: 'bg-[#f14c4c] dark:bg-[#f48771]',
    },
    cancelled: {
        pill: 'border-[#e8912d]/30 bg-[#e8912d]/10 text-[#e8912d] dark:text-[#cca700]',
        dot: 'bg-[#e8912d] dark:bg-[#cca700]',
    },
};

const FALLBACK: StatusVariant = {
    pill: 'border-[#cccccc] bg-[#f3f3f3] text-[#5a5a5a] dark:bg-[#2d2d2d] dark:text-[#cccccc]',
    dot: 'bg-[#848484]',
};

export function ChatStatusPill({
    status,
    type,
    durationMs,
    showDuration = true,
    iconOnly = false,
    className,
    'data-testid': dataTestId,
}: ChatStatusPillProps) {
    const variant = VARIANT[status] ?? FALLBACK;
    const label = statusLabel(status, type);
    const duration = showDuration && durationMs != null ? formatDuration(durationMs) : '';

    return (
        <span
            data-testid={dataTestId}
            data-status={status}
            className={cn(
                'inline-flex items-center gap-1.5 border rounded-full whitespace-nowrap',
                'text-[11px] leading-none font-medium',
                iconOnly ? 'h-[18px] w-[18px] justify-center p-0' : 'h-[20px] px-2',
                variant.pill,
                className,
            )}
            title={duration ? `${label} · ${duration}` : label}
        >
            <span
                className={cn(
                    'inline-block w-[6px] h-[6px] rounded-full flex-shrink-0',
                    variant.dot,
                    variant.pulse && 'animate-pulse',
                )}
                aria-hidden="true"
            />
            {!iconOnly && (
                <>
                    <span className="font-medium">{label}</span>
                    {duration && (
                        <>
                            <span aria-hidden="true" className="opacity-50">·</span>
                            <span className="font-mono text-[10.5px] opacity-80 tabular-nums">{duration}</span>
                        </>
                    )}
                </>
            )}
        </span>
    );
}
