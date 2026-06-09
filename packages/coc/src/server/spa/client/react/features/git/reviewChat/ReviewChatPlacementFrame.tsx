import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { ReviewChatPresentation } from '../commits/commitChatPlacement';
import { getCommitChatLensDormantMode } from '../../../utils/config';

export type LensDormantMode = 'ghost' | 'pill';

export interface ReviewChatPlacementFrameProps {
    title: string;
    identifier?: string;
    presentation: ReviewChatPresentation;
    onClose: () => void;
    isMinimized?: boolean;
    onMinimize?: () => void;
    onRestore?: () => void;
    onPin?: () => void;
    onUnpin?: () => void;
    testIdPrefix?: string;
    children: ReactNode;
}

const LENS_MARGIN_PX = 16;
const MIN_LENS_WIDTH_PX = 320;
const MIN_LENS_HEIGHT_PX = 320;
const DORMANT_DELAY_MS = 600;
const DORMANT_TRANSITION_MS = 500;
const DORMANT_GHOST_OPACITY = 0.18;
const DORMANT_GHOST_SCALE = 0.94;
const HIT_PAD_PX = 12;
const HIT_PAD_PILL_PX = 8;

function MinimizeIcon() {
    return (
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

function PinIcon() {
    return (
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path
                d="M6 2.75h4l-.6 3.5 2.1 2.1v1.15h-7V8.35l2.1-2.1L6 2.75Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
            <path d="M8 9.5v3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

function clampLensSize(width: number, height: number) {
    const viewportWidth = window.innerWidth || MIN_LENS_WIDTH_PX + LENS_MARGIN_PX * 2;
    const viewportHeight = window.innerHeight || MIN_LENS_HEIGHT_PX + LENS_MARGIN_PX * 2;
    const maxWidth = Math.max(MIN_LENS_WIDTH_PX, viewportWidth - LENS_MARGIN_PX * 2);
    const maxHeight = Math.max(MIN_LENS_HEIGHT_PX, viewportHeight - LENS_MARGIN_PX * 2);

    return {
        width: Math.min(Math.max(width, MIN_LENS_WIDTH_PX), maxWidth),
        height: Math.min(Math.max(height, MIN_LENS_HEIGHT_PX), maxHeight),
    };
}

function distanceToRect(cx: number, cy: number, rect: DOMRect): number {
    const dx = Math.max(rect.left - cx, 0, cx - rect.right);
    const dy = Math.max(rect.top - cy, 0, cy - rect.bottom);
    return Math.hypot(dx, dy);
}

/**
 * Manages lens focus via document-level mousemove hit-testing.
 *
 * mouseenter/leave is unreliable when child elements toggle pointerEvents
 * (ghost mode) or when the hit-target changes shape (pill collapse).
 * Instead, we continuously check cursor distance to the active hit-rect
 * (card when focused, pill when dormant in pill mode) on every mousemove.
 */
function useLensDormantState(
    cardRef: React.RefObject<HTMLElement | null>,
    pillRef: React.RefObject<HTMLElement | null>,
    isLens: boolean,
    isExplicitlyMinimized: boolean,
) {
    const [focused, setFocused] = useState(true);
    const focusedRef = useRef(true);
    const dormantTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dormantMode = isLens ? getCommitChatLensDormantMode() : 'ghost';

    const setFocusedSync = useCallback((v: boolean) => {
        if (focusedRef.current === v) return;
        focusedRef.current = v;
        setFocused(v);
    }, []);

    const clearDormantTimer = useCallback(() => {
        if (dormantTimerRef.current) {
            clearTimeout(dormantTimerRef.current);
            dormantTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!isLens || isExplicitlyMinimized) {
            clearDormantTimer();
            setFocusedSync(true);
            return;
        }

        const tick = (cx: number, cy: number) => {
            const isPill = dormantMode === 'pill' && !focusedRef.current;
            const hitEl = isPill ? pillRef.current : cardRef.current;
            if (!hitEl) return;

            const pad = isPill ? HIT_PAD_PILL_PX : HIT_PAD_PX;
            const rect = hitEl.getBoundingClientRect();
            const d = distanceToRect(cx, cy, rect);
            const inside = d <= pad;

            if (inside) {
                clearDormantTimer();
                setFocusedSync(true);
            } else if (focusedRef.current && !dormantTimerRef.current) {
                dormantTimerRef.current = setTimeout(() => {
                    dormantTimerRef.current = null;
                    setFocusedSync(false);
                }, DORMANT_DELAY_MS);
            }
        };

        let lastTick = 0;
        const onMove = (e: MouseEvent) => {
            const now = Date.now();
            if (now - lastTick < 24) return;
            lastTick = now;
            tick(e.clientX, e.clientY);
        };

        window.addEventListener('mousemove', onMove);
        const kickTimer = setTimeout(() => tick(-9999, -9999), 30);
        const poll = setInterval(() => tick(-9999, -9999), 250);

        return () => {
            window.removeEventListener('mousemove', onMove);
            clearTimeout(kickTimer);
            clearInterval(poll);
            clearDormantTimer();
        };
    }, [isLens, isExplicitlyMinimized, dormantMode, clearDormantTimer, setFocusedSync, cardRef, pillRef]);

    return { focused, dormantMode };
}

export function ReviewChatPlacementFrame({
    title,
    identifier,
    presentation,
    onClose,
    isMinimized = false,
    onMinimize,
    onRestore,
    onPin,
    onUnpin,
    testIdPrefix = 'review-chat',
    children,
}: ReviewChatPlacementFrameProps) {
    const cardRef = useRef<HTMLDivElement | null>(null);
    const pillRef = useRef<HTMLDivElement | null>(null);
    const [lensSize, setLensSize] = useState<{ width: number; height: number } | null>(null);
    const isLens = presentation === 'lens';
    const placementTestId = isLens ? 'lens' : 'side-panel';
    const explicitlyMinimized = isLens && isMinimized && !!onRestore;

    const { focused, dormantMode } =
        useLensDormantState(cardRef, pillRef, isLens, explicitlyMinimized);

    const dormant = isLens && !focused && !explicitlyMinimized;
    const isDormantPill = dormant && dormantMode === 'pill';
    const isDormantGhost = dormant && dormantMode === 'ghost';

    const rootClassName = isLens
        ? 'absolute bottom-4 right-4 z-30 flex flex-col overflow-visible'
        : 'flex h-full w-full flex-col overflow-hidden bg-[#f8f8f8] dark:bg-[#1e1e1e]';

    const cardTransition = `opacity ${DORMANT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${DORMANT_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;

    const lensOuterStyle: CSSProperties | undefined = isLens
        ? {
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100vh - 2rem)',
            transformOrigin: 'bottom right',
            ...(lensSize
                ? {
                    width: `${lensSize.width}px`,
                    height: `${lensSize.height}px`,
                }
                : {
                    width: 'min(420px, calc(100% - 2rem))',
                    maxWidth: '420px',
                    height: '55vh',
                    maxHeight: '55vh',
                    minHeight: '320px',
                }),
        }
        : undefined;

    const cardStyle: CSSProperties = isDormantGhost
        ? {
            opacity: DORMANT_GHOST_OPACITY,
            transform: `scale(${DORMANT_GHOST_SCALE}) translateY(10px)`,
            pointerEvents: 'none',
            transition: cardTransition,
        }
        : isDormantPill
            ? {
                opacity: 0,
                transform: 'scale(0.5) translateY(20px)',
                pointerEvents: 'none',
                transition: cardTransition,
            }
            : {
                opacity: 1,
                transform: 'scale(1) translateY(0)',
                pointerEvents: 'auto',
                transition: cardTransition,
            };

    const pillStyle: CSSProperties = isDormantPill
        ? {
            opacity: 1,
            transform: 'scale(1)',
            pointerEvents: 'auto',
            transition: cardTransition,
        }
        : {
            opacity: 0,
            transform: 'scale(0.6) translateY(8px)',
            pointerEvents: 'none',
            transition: cardTransition,
        };

    const handleRestoreKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onRestore?.();
    };

    const handleResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
        if (!cardRef.current) return;

        event.preventDefault();
        event.stopPropagation();

        const frameRect = cardRef.current.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = frameRect.width;
        const startHeight = frameRect.height;
        const originalCursor = document.body.style.cursor;
        const originalUserSelect = document.body.style.userSelect;

        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const nextWidth = startWidth - (moveEvent.clientX - startX);
            const nextHeight = startHeight - (moveEvent.clientY - startY);
            setLensSize(clampLensSize(nextWidth, nextHeight));
        };

        const handleMouseUp = () => {
            document.body.style.cursor = originalCursor;
            document.body.style.userSelect = originalUserSelect;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        setLensSize(clampLensSize(startWidth, startHeight));
    }, []);

    if (explicitlyMinimized) {
        return (
            <>
                <div className="hidden" aria-hidden="true" data-testid={`${testIdPrefix}-lens-hidden-body`}>
                    {children}
                </div>
                <div
                    role="button"
                    tabIndex={0}
                    onClick={onRestore}
                    onKeyDown={handleRestoreKeyDown}
                    aria-label={`Restore ${title}${identifier ? ` ${identifier}` : ''}`}
                    className="absolute bottom-4 right-4 z-30 flex max-w-[min(360px,calc(100%-2rem))] cursor-pointer items-center gap-2 rounded-full border border-[#d0d7de] bg-[#f8f8f8] px-3 py-2 shadow-2xl hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#0078d4] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:hover:bg-[#252526]"
                    data-testid={`${testIdPrefix}-lens-minimized`}
                >
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            💬 {title}
                        </span>
                        {identifier && (
                            <span className="shrink-0 rounded bg-[#e8e8e8] px-1.5 py-0.5 font-mono text-[10px] text-blue-600 dark:bg-[#333] dark:text-blue-400">
                                {identifier}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onRestore();
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                        data-testid={`${testIdPrefix}-restore-btn`}
                        title="Restore chat lens"
                    >
                        Restore
                    </button>
                </div>
            </>
        );
    }

    return (
        <div
            className={rootClassName}
            data-testid={`${testIdPrefix}-${placementTestId}`}
            data-dormant-mode={isLens ? dormantMode : undefined}
            data-focused={isLens ? String(focused) : undefined}
            style={lensOuterStyle}
        >
            {/* Dormant pill — positioned at the bottom-right of the outer container */}
            {isLens && dormantMode === 'pill' && (
                <div
                    ref={pillRef}
                    className="absolute bottom-0 right-0 z-10 flex max-w-[320px] cursor-pointer items-center gap-2.5 rounded-full border border-[#d0d7de] bg-[#f8f8f8] px-3.5 py-2 shadow-2xl hover:bg-white dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:hover:bg-[#252526]"
                    style={{
                        ...pillStyle,
                        transformOrigin: 'bottom right',
                    }}
                    data-testid={`${testIdPrefix}-lens-dormant-pill`}
                >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1e1e1e] font-mono text-[10px] font-semibold text-white dark:bg-[#cccccc] dark:text-[#1e1e1e]">
                        C
                    </span>
                    <span className="flex min-w-0 flex-col gap-px">
                        <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#848484]">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0078d4] shadow-[0_0_0_3px_rgba(0,120,212,0.15)]" />
                            💬 {title}
                        </span>
                        {identifier && (
                            <span className="truncate font-mono text-[11px] text-[#1e1e1e] dark:text-[#cccccc]">
                                {identifier}
                            </span>
                        )}
                    </span>
                </div>
            )}

            {/* Main card */}
            <div
                ref={cardRef}
                className={isLens
                    ? 'flex h-full w-full flex-col overflow-hidden rounded-lg border border-[#d0d7de] bg-[#f8f8f8] shadow-2xl dark:border-[#3c3c3c] dark:bg-[#1e1e1e]'
                    : 'flex h-full w-full flex-col overflow-hidden'}
                style={isLens ? cardStyle : undefined}
                data-testid={isLens ? `${testIdPrefix}-lens-card` : undefined}
            >
                {isLens && (
                    <button
                        type="button"
                        aria-label={`Resize ${title}${identifier ? ` ${identifier}` : ''}`}
                        className="absolute left-1 top-1 z-10 h-3.5 w-3.5 cursor-nwse-resize text-[#6e7781] hover:text-[#24292f] focus:outline-none focus:ring-2 focus:ring-[#0078d4] dark:text-[#cccccc] dark:hover:text-white"
                        data-testid={`${testIdPrefix}-lens-resize-grip`}
                        onMouseDown={handleResizeMouseDown}
                        title="Resize chat lens"
                    >
                        <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0.5 h-2 w-2 border-l border-t border-current" />
                    </button>
                )}
                <div
                    className="flex items-center justify-between gap-2 border-b border-[#e0e0e0] px-3 py-2 dark:border-[#3c3c3c]"
                    data-testid={`${testIdPrefix}-${placementTestId}-header`}
                >
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            💬 {title}
                        </span>
                        {identifier && (
                            <span className="rounded bg-[#e8e8e8] px-1.5 py-0.5 font-mono text-[10px] text-blue-600 dark:bg-[#333] dark:text-blue-400">
                                {identifier}
                            </span>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {isLens && onMinimize && (
                            <button
                                type="button"
                                onClick={onMinimize}
                                aria-label="Minimize chat lens"
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                                data-testid={`${testIdPrefix}-minimize-btn`}
                                title="Minimize chat lens"
                            >
                                <MinimizeIcon />
                            </button>
                        )}
                        {isLens && onPin && (
                            <button
                                type="button"
                                onClick={onPin}
                                aria-label="Pin to side panel"
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                                data-testid={`${testIdPrefix}-pin-btn`}
                                title="Pin to side panel"
                            >
                                <PinIcon />
                            </button>
                        )}
                        {!isLens && onUnpin && (
                            <button
                                type="button"
                                onClick={onUnpin}
                                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                                data-testid={`${testIdPrefix}-unpin-btn`}
                                title="Unpin from side panel"
                            >
                                Unpin
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded px-1 py-0.5 text-xs text-[#848484] hover:bg-black/[0.06] hover:text-[#1e1e1e] dark:hover:bg-white/[0.08] dark:hover:text-white"
                            data-testid={`${testIdPrefix}-frame-close-btn`}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>
                <div className="min-h-0 flex-1">
                    {children}
                </div>
            </div>
        </div>
    );
}
