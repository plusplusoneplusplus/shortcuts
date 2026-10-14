/**
 * RailHoverPreview — shared count controls + hover/focus preview popover for the
 * collapsed workspace rail. `RailJobStatuses` (running/queued) and
 * `RailPinnedJobs` supply their own rows; this owns the 200ms open, 250ms leave,
 * pointer bridge, keyboard entry, Escape/outside dismissal and focus return.
 */
import { createContext, useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn, usePortalContainer } from '../../ui';
import { useAnchoredPanelPosition } from '../../shared/useAnchoredPanelPosition';
import { useHoverPopoverDismissal } from '../chat/conversation/tool-calls/hoverPopover';

/**
 * Rail behavior for controls rendered outside `SplitWorkspacePanel` (portaled
 * rail shortcuts): fine-pointer hover, sidebar expansion, and full-rail peek close.
 */
export interface RailControls {
    hoverEnabled: boolean;
    onExpand: () => void;
    onPreview: () => void;
    /** Focus a stable rail control when the last preview row is removed. */
    onFocusRail?: () => void;
    /** Expand the sidebar with its Git half open; `changes` reveals the working tree. */
    onOpenGit?: (target: 'changes' | 'branch') => void;
}
export const RailControlsContext = createContext<RailControls | null>(null);

export interface RailPreviewControl {
    key: string;
    count: number;
    /** Accessible name, e.g. "2 running jobs". */
    label: string;
    /** Popover heading before the count, e.g. "Running jobs". */
    heading: string;
    className: string;
    badgeClassName: string;
    icon: ReactNode;
    /** List rows; `dismiss` closes the preview without restoring focus. */
    renderRows: (dismiss: () => void, focusAfterRemoval: (action: HTMLElement) => void) => ReactNode;
    /** Replaces the icon and count badge (status tiles that are not counts). */
    content?: ReactNode;
    /** Replaces the default 28px square trigger size. */
    sizeClassName?: string;
    /** Click action; defaults to expanding the sidebar. */
    onClick?: () => void;
    /** Extra accessible description; defaults to the job-preview hint. */
    description?: string;
    /** Show `(count)` after the heading. Defaults to true. */
    headingCount?: boolean;
    closeLabel?: string;
}

interface Props extends RailControls {
    controls: readonly RailPreviewControl[];
    /** Scope shown under the heading; undefined disables previews (counts only). */
    scopeLabel?: string;
}

export function RailHoverPreview({ controls, scopeLabel, hoverEnabled, onExpand, onPreview, onFocusRail }: Props) {
    const [active, setActive] = useState<string | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
    const panelRef = useRef<HTMLDivElement | null>(null);
    const enterTimer = useRef<ReturnType<typeof setTimeout>>();
    const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
    const suppressed = useRef(false);
    const restoringFocus = useRef(false);
    const touch = useRef(false);
    const enterActions = useRef(false);
    const id = useId();
    const previewable = scopeLabel !== undefined;
    const current = controls.find(control => control.key === active);
    const count = current?.count ?? 0;
    const open = !!current && count > 0 && previewable;
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
        setActive(null);
        if (restoreFocus) {
            restoringFocus.current = true;
            triggerRef.current?.focus();
            restoringFocus.current = false;
        }
    }, [clearTimers]);
    const escape = useCallback(() => dismiss(true), [dismiss]);
    const close = useCallback(() => dismiss(), [dismiss]);
    const focusAfterRemoval = (action: HTMLElement) => {
        const row = action.closest('li');
        if (!row?.contains(document.activeElement)) return;
        const neighbor = row.nextElementSibling ?? row.previousElementSibling;
        if (neighbor) {
            neighbor.querySelector<HTMLElement>('a, button:not([disabled])')?.focus();
        } else {
            dismiss();
            onFocusRail?.();
        }
    };
    useHoverPopoverDismissal(open, triggerRef, panelRef, dismiss, escape);
    useEffect(() => () => clearTimers(), [clearTimers]);
    useEffect(() => {
        if (active && count === 0) {
            dismiss();
            triggerRef.current = null;
        }
    }, [active, count, dismiss]);

    const show = (next: string) => {
        clearTimers();
        if (!previewable || suppressed.current) return;
        triggerRef.current = triggers.current[next] ?? null;
        onPreview();
        setActive(next);
    };
    const leave = (focusLeft = false) => {
        clearTimers();
        const focused = document.activeElement;
        const within = !!panelRef.current?.contains(focused) || !!triggerRef.current?.contains(focused);
        if (focusLeft || !within) leaveTimer.current = setTimeout(() => setActive(null), 250);
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
        anchorKey: `${active}:${count}`,
    });
    useEffect(() => {
        if (open && portal && enterActions.current) {
            enterActions.current = false;
            panelRef.current?.querySelector<HTMLElement>('button, a')?.focus();
        }
    }, [open, portal, active]);
    const keyDown = (event: KeyboardEvent<HTMLButtonElement>, next: string) => {
        if (previewable && (event.key === 'ArrowRight' || event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey && open))) {
            event.preventDefault();
            suppressed.current = false;
            enterActions.current = true;
            show(next);
            if (open && active === next) {
                enterActions.current = false;
                panelRef.current?.querySelector<HTMLElement>('button, a')?.focus();
            }
        }
    };
    const anchor = triggerRef.current?.getBoundingClientRect();
    const panelWidth = Math.min(310, position.maxWidth ?? 310);
    const bridgeLeft = anchor ? Math.min(anchor.right, position.left + panelWidth) : 0;
    const bridgeRight = anchor ? (position.left >= anchor.right ? position.left : anchor.left) : 0;
    return (
        <>
            {controls.map(control => control.count > 0 && (
                <button
                    key={control.key}
                    ref={node => { triggers.current[control.key] = node; }}
                    type="button"
                    data-rail-job-status
                    data-testid={`split-workspace-left-${control.key}`}
                    aria-label={control.label}
                    aria-description={previewable ? `${scopeLabel}. ${control.description ?? 'Focus to preview; click expands sidebar.'}` : undefined}
                    aria-haspopup={previewable ? 'dialog' : undefined}
                    aria-expanded={previewable ? open && active === control.key : undefined}
                    aria-controls={open && active === control.key ? id : undefined}
                    className={cn(
                        'relative flex items-center justify-center rounded-md border transition-colors',
                        control.sizeClassName ?? 'h-7 w-7',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/50',
                        control.className,
                    )}
                    onPointerEnter={event => {
                        touch.current = event.pointerType === 'touch';
                        if (triggerRef.current !== triggers.current[control.key]) suppressed.current = false;
                        onPreview();
                        clearTimers();
                        if (hoverEnabled && !touch.current && !suppressed.current && previewable) {
                            enterTimer.current = setTimeout(() => show(control.key), 200);
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
                            show(control.key);
                        }
                    }}
                    onBlur={blur}
                    onKeyDown={event => keyDown(event, control.key)}
                    onClick={() => {
                        dismiss();
                        (control.onClick ?? onExpand)();
                    }}
                >
                    {control.content ?? <>
                        {control.icon}
                        <span className={cn(
                            'absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5',
                            'border border-white text-[8px] font-bold leading-none text-white dark:border-[#1e1e1e]',
                            control.badgeClassName,
                        )} aria-hidden="true">{control.count > 99 ? '99+' : control.count}</span>
                    </>}
                </button>
            ))}
            {open && portal && current && createPortal(
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
                            // Embedded controls (such as the branch picker) own handled keys.
                            if (event.defaultPrevented) return;
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
                                    {current.heading}{current.headingCount !== false && <> <span className="font-normal text-[#848484]">({count})</span></>}
                                </div>
                                <div className="mt-0.5 break-words text-[11px] text-[#656d76] dark:text-[#aaa]">{scopeLabel}</div>
                            </div>
                            <button type="button" aria-label={current.closeLabel ?? 'Close job preview'} className="h-[22px] w-[22px] flex-shrink-0 rounded text-xs text-[#848484] hover:bg-[#f3f3f3] focus-visible:outline focus-visible:outline-[#007acc] dark:hover:bg-[#333]" onClick={() => dismiss(true)}>x</button>
                        </header>
                        <ul>{current.renderRows(close, focusAfterRemoval)}</ul>
                    </div>
                </div>, portal,
            )}
        </>
    );
}

interface RowProps {
    title: string;
    meta: ReactNode;
    href?: string;
    onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
    action?: ReactNode;
}

/** One compact preview row: clamped title, status/type meta, and an Open job link. */
export function RailPreviewRow({ title, meta, href, onOpen, action }: RowProps) {
    return (
        <li className="flex items-start gap-2 border-b border-[#e5e5e5] px-3 py-2 last:border-0 dark:border-[#3c3c3c]">
            <div className="min-w-0 flex-1">
                <div className="line-clamp-2 break-words text-xs font-medium" title={title}>{title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[#656d76] dark:text-[#aaa]">{meta}</div>
            </div>
            {href && <a href={href} aria-label={`Open job: ${title}`}
                className="flex-shrink-0 rounded border border-[#d0d7de] px-1.5 py-0.5 text-[10px] text-[#1878c8] hover:bg-[#eaf4ff] focus-visible:outline focus-visible:outline-[#007acc] dark:border-[#3c3c3c] dark:text-[#3794ff] dark:hover:bg-[#19384f]"
                onClick={onOpen}>Open job</a>}
            {action}
        </li>
    );
}
