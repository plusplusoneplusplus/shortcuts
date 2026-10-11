import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn, usePortalContainer } from '../../ui';
import { useAnchoredPanelPosition } from '../../shared/useAnchoredPanelPosition';
import { useHoverPopoverDismissal } from '../chat/conversation/tool-calls/hoverPopover';
import { ChatStatusPill } from '../chat/ChatStatusPill';
import { getTaskDef } from '../../../../../tasks/task-types';
import type { QueueJob } from '../../queue/hooks/useRepoQueueStats';
import { queueJobHash } from '../../queue/queueJobRoute';

type Status = 'running' | 'queued';

export interface RailJobPreview {
    running: readonly QueueJob[];
    queued: readonly QueueJob[];
    scopeLabel: string;
    /** Concrete dashboard selection, including the owning server for clones. */
    routeId: string;
    /** Includes the transport identity; changing it disposes the preview. */
    scopeKey: string;
}

interface Props {
    runningCount: number;
    queuedCount: number;
    preview?: RailJobPreview;
    hoverEnabled: boolean;
    onExpand: () => void;
    onPreview: () => void;
}

export function RailJobStatuses({ runningCount, queuedCount, preview, hoverEnabled, onExpand, onPreview }: Props) {
    const [status, setStatus] = useState<Status | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const triggers = useRef<Partial<Record<Status, HTMLButtonElement | null>>>({});
    const panelRef = useRef<HTMLDivElement | null>(null);
    const enterTimer = useRef<ReturnType<typeof setTimeout>>();
    const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
    const suppressed = useRef(false);
    const restoringFocus = useRef(false);
    const touch = useRef(false);
    const enterActions = useRef(false);
    const id = useId();
    const counts = preview
        ? { running: preview.running.length, queued: preview.queued.length }
        : { running: runningCount, queued: queuedCount };
    const open = status !== null && counts[status] > 0 && preview !== undefined;
    const portal = usePortalContainer(open);

    const clearTimers = useCallback(() => {
        clearTimeout(enterTimer.current);
        clearTimeout(leaveTimer.current);
        enterTimer.current = undefined;
        leaveTimer.current = undefined;
    }, []);
    const dismiss = useCallback((restoreFocus = false) => {
        clearTimers();
        suppressed.current = true;
        enterActions.current = false;
        setStatus(null);
        if (restoreFocus) {
            restoringFocus.current = true;
            triggerRef.current?.focus();
            restoringFocus.current = false;
        }
    }, [clearTimers]);
    const escape = useCallback(() => dismiss(true), [dismiss]);
    useHoverPopoverDismissal(open, triggerRef, panelRef, dismiss, escape);
    useEffect(() => () => clearTimers(), [clearTimers]);
    useEffect(() => {
        if (status && counts[status] === 0) {
            dismiss();
            triggerRef.current = null;
        }
    }, [status, counts.running, counts.queued, dismiss]);

    const show = (next: Status) => {
        clearTimers();
        if (!preview || suppressed.current) return;
        triggerRef.current = triggers.current[next] ?? null;
        onPreview();
        setStatus(next);
    };
    const leave = (focusLeft = false) => {
        clearTimers();
        const active = document.activeElement;
        const focused = !!panelRef.current?.contains(active) || !!triggerRef.current?.contains(active);
        if (focusLeft || !focused) leaveTimer.current = setTimeout(() => setStatus(null), 250);
    };
    const blur = (event: FocusEvent<HTMLElement>) => {
        const next = event.relatedTarget;
        const focusWithin = next instanceof Node
            && (!!panelRef.current?.contains(next) || !!triggerRef.current?.contains(next));
        if (!focusWithin) {
            suppressed.current = false;
            leave(true);
        }
    };
    const position = useAnchoredPanelPosition({
        open: open && portal !== null,
        placement: 'right',
        triggerRef,
        panelRef,
        gap: 8,
        anchorKey: `${status}:${status ? counts[status] : 0}`,
    });
    useEffect(() => {
        if (open && portal && enterActions.current) {
            enterActions.current = false;
            panelRef.current?.querySelector('button, a')?.focus();
        }
    }, [open, portal, status]);
    const keyDown = (event: KeyboardEvent<HTMLButtonElement>, next: Status) => {
        if (preview && (event.key === 'ArrowRight' || event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey && open))) {
            event.preventDefault();
            suppressed.current = false;
            enterActions.current = true;
            show(next);
            if (open && status === next) {
                enterActions.current = false;
                panelRef.current?.querySelector('button, a')?.focus();
            }
        }
    };
    const icon = (next: Status) => {
        const count = counts[next];
        if (count <= 0) return null;
        const running = next === 'running';
        const label = `${count} ${next} ${count === 1 ? 'job' : 'jobs'}`;
        return (
            <button
                key={next}
                ref={node => { triggers.current[next] = node; }}
                type="button"
                data-rail-job-status
                data-testid={`split-workspace-left-${next}`}
                aria-label={label}
                aria-description={preview ? `${preview.scopeLabel}. Focus to preview; click expands sidebar.` : undefined}
                aria-haspopup={preview ? 'dialog' : undefined}
                aria-expanded={preview ? open && status === next : undefined}
                aria-controls={open && status === next ? id : undefined}
                className={cn(
                    'relative flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/50',
                    running
                        ? 'border-[#b9d9f7] bg-[#eaf4ff] text-[#1878c8] hover:bg-[#dceeff] dark:border-[#245c88] dark:bg-[#152d40] dark:text-[#4daaf0] dark:hover:bg-[#19384f]'
                        : 'border-[#efd99c] bg-[#fff8e7] text-[#a06b00] hover:bg-[#fff1cc] dark:border-[#70551c] dark:bg-[#382d16] dark:text-[#e0aa36] dark:hover:bg-[#44371b]',
                )}
                onPointerEnter={event => {
                    touch.current = event.pointerType === 'touch';
                    if (triggerRef.current !== triggers.current[next]) suppressed.current = false;
                    onPreview();
                    clearTimers();
                    if (hoverEnabled && !touch.current && !suppressed.current && preview) {
                        enterTimer.current = setTimeout(() => show(next), 200);
                    }
                }}
                onPointerLeave={() => {
                    suppressed.current = false;
                    leave();
                }}
                onPointerDown={event => { touch.current = event.pointerType === 'touch'; }}
                onFocus={() => {
                    if (!touch.current && !restoringFocus.current) {
                        suppressed.current = false;
                        show(next);
                    }
                }}
                onBlur={blur}
                onKeyDown={event => keyDown(event, next)}
                onClick={() => {
                    dismiss();
                    onExpand();
                }}
            >
                {running ? (
                    <span className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3.5 2h7M3.5 12h7M4 2c0 2.3 1.6 2.7 3 5-1.4 2.3-3 2.7-3 5M10 2c0 2.3-1.6 2.7-3 5 1.4 2.3 3 2.7 3 5" />
                    </svg>
                )}
                <span className={cn(
                    'absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5',
                    'border border-white text-[8px] font-bold leading-none text-white dark:border-[#1e1e1e]',
                    running ? 'bg-[#1878c8]' : 'bg-[#b77900]',
                )} aria-hidden="true">{count > 99 ? '99+' : count}</span>
            </button>
        );
    };
    const anchor = triggerRef.current?.getBoundingClientRect();
    const panelWidth = Math.min(310, position.maxWidth ?? 310);
    const bridgeLeft = anchor ? Math.min(anchor.right, position.left + panelWidth) : 0;
    const bridgeRight = anchor ? (position.left >= anchor.right ? position.left : anchor.left) : 0;
    return (
        <>
            {icon('running')}
            {icon('queued')}
            {open && portal && preview && status && createPortal(
                <div
                    data-rail-job-preview
                    onPointerEnter={clearTimers}
                    onPointerLeave={() => leave()}
                    onFocusCapture={clearTimers}
                    onBlurCapture={blur}
                >
                    <div
                        aria-hidden="true"
                        data-testid="rail-job-preview-bridge"
                        className="fixed z-50"
                        style={{ left: bridgeLeft, top: anchor?.top, width: Math.max(0, bridgeRight - bridgeLeft), height: anchor?.height }}
                    />
                    <div
                        ref={panelRef}
                        id={id}
                        role="dialog"
                        aria-modal="false"
                        aria-labelledby={`${id}-heading`}
                        data-testid="rail-job-preview"
                        data-native-view-overlay
                        className="fixed z-50 w-[310px] overflow-auto rounded-md border border-[#d0d7de] bg-white text-[#1e1e1e] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
                        style={{ ...position }}
                        onKeyDown={event => {
                            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                            const actions = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a'));
                            const index = actions.findIndex(action => action === document.activeElement);
                            const next = actions[index + (event.key === 'ArrowDown' ? 1 : -1)];
                            if (next) { event.preventDefault(); next.focus(); }
                        }}
                    >
                        <header className="flex items-start justify-between gap-2 border-b border-[#e5e5e5] px-3 py-2 dark:border-[#3c3c3c]">
                            <div className="min-w-0">
                                <div id={`${id}-heading`} className="text-xs font-semibold">
                                    {status === 'running' ? 'Running' : 'Queued'} jobs <span className="font-normal text-[#848484]">({counts[status]})</span>
                                </div>
                                <div className="mt-0.5 break-words text-[11px] text-[#656d76] dark:text-[#aaa]">{preview.scopeLabel}</div>
                            </div>
                            <button type="button" aria-label="Close job preview" className="h-[22px] w-[22px] flex-shrink-0 rounded text-xs text-[#848484] hover:bg-[#f3f3f3] focus-visible:outline focus-visible:outline-[#007acc] dark:hover:bg-[#333]" onClick={() => dismiss(true)}>x</button>
                        </header>
                        <ul>
                            {preview[status].map(job => {
                                const pauseMarker = job.kind === 'pause-marker';
                                const title = job.displayName || (pauseMarker ? 'Queue pause' : getTaskDef(job.type ?? '')?.label || job.type || 'Job');
                                return (
                                    <li key={job.id} className="flex items-start gap-2 border-b border-[#e5e5e5] px-3 py-2 last:border-0 dark:border-[#3c3c3c]">
                                        <div className="min-w-0 flex-1">
                                            <div className="line-clamp-2 break-words text-xs font-medium" title={title}>{title}</div>
                                            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[#656d76] dark:text-[#aaa]">
                                                <ChatStatusPill status={status} showDuration={false} className="!h-[18px] !text-[10px]" />
                                                <span>{getTaskDef(job.type ?? '')?.label || job.type}</span>
                                                {job.payload?.mode && <span>{job.payload.mode}</span>}
                                            </div>
                                        </div>
                                        {!pauseMarker && <a href={queueJobHash(preview.routeId, job)} aria-label={`Open job: ${title}`}
                                            className="flex-shrink-0 rounded border border-[#d0d7de] px-1.5 py-0.5 text-[10px] text-[#1878c8] hover:bg-[#eaf4ff] focus-visible:outline focus-visible:outline-[#007acc] dark:border-[#3c3c3c] dark:text-[#3794ff] dark:hover:bg-[#19384f]"
                                            onClick={() => dismiss()}>Open job</a>}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>, portal,
            )}
        </>
    );
}
