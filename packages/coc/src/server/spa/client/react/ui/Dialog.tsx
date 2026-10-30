import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { usePortalContainer } from './usePortalContainer';

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    /** When provided, a minimize button (−) is rendered in the header next to the title. */
    onMinimize?: () => void;
    title?: string;
    children?: ReactNode;
    footer?: ReactNode;
    className?: string;
    /** Optional id applied to the outer overlay div for test selection. */
    id?: string;
    /** When true, the header close button is visually disabled and non-interactive. */
    disableClose?: boolean;
    /**
     * When provided, replaces the built-in header entirely. The consumer owns all
     * header UI. When set, `title`, `onMinimize`, and `disableClose` have no effect
     * on the header.
     */
    renderHeader?: () => ReactNode;
    /** When true, the dialog remains mounted but is visually hidden and inert. */
    hidden?: boolean;
    /**
     * When true (desktop only), the panel uses tighter padding/gap so more of the
     * dialog height goes to the body. Used by content-dense readers (e.g. the
     * full-window PDF popup) that want maximum room for the actual content.
     */
    dense?: boolean;
    /**
     * When true (desktop only), the panel drops its 1px border and all inner
     * padding/gap so the child fills the rounded panel edge-to-edge, like a
     * native settings window. Opt-in: every other dialog keeps the framed look.
     * Rounded corners + `overflow-hidden` still clip the content.
     */
    borderless?: boolean;
    /** Opt in to keyboard focus containment and restoration for modal readers. */
    trapFocus?: boolean;
    returnFocusRef?: RefObject<HTMLElement | null>;
}

export function Dialog({ open, onClose, onMinimize, title, children, footer, className, id, disableClose, renderHeader, hidden, dense, borderless, trapFocus, returnFocusRef }: DialogProps) {
    const { isMobile } = useBreakpoint();
    const portalContainer = usePortalContainer(open);
    const panelRef = useRef<HTMLDivElement>(null);

    const isTopDialog = () => {
        const overlays = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="dialog-overlay"]'))
            .filter(element => element.getAttribute('aria-hidden') !== 'true');
        return overlays[overlays.length - 1]?.contains(panelRef.current) ?? false;
    };

    useEffect(() => {
        if (!open || hidden || !trapFocus) return;
        const panel = panelRef.current;
        if (!panel) return;
        const previous = returnFocusRef?.current ?? document.activeElement;
        const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
            ':is(button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"])',
        )).filter(element => !element.closest('[hidden], [inert], details:not([open]) > :not(summary)'));
        (panel.querySelector<HTMLElement>('[data-dialog-initial-focus]') ?? focusable()[0] ?? panel).focus();
        const contain = (event: FocusEvent) => {
            if (isTopDialog() && !panel.contains(event.target as Node)) (focusable()[0] ?? panel).focus();
        };
        const keydown = (event: KeyboardEvent) => {
            if (event.key !== 'Tab' || !isTopDialog()) return;
            const elements = focusable();
            const first = elements[0] ?? panel;
            const last = elements[elements.length - 1] ?? panel;
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
                event.preventDefault(); first.focus();
            }
        };
        document.addEventListener('focusin', contain);
        panel.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('focusin', contain);
            panel.removeEventListener('keydown', keydown);
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        };
    }, [open, hidden, trapFocus, returnFocusRef]);

    useEffect(() => {
        if (!open || hidden) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isTopDialog()) onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, hidden, onClose]);

    if (!open || !portalContainer) return null;

    const hasMaxWOverride = className ? /\bmax-w-\[/.test(className) : false;

    const overlayClass = isMobile
        ? 'fixed inset-0 z-[10002] bg-white dark:bg-[#252526]'
        : 'fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 dark:bg-black/60';

    const desktopBase = cn(
        'relative w-full max-h-[90vh] overflow-hidden rounded-lg bg-white dark:bg-[#252526] shadow-xl flex flex-col',
        !borderless && 'border border-[#c8c8c8] dark:border-[#555555]',
    );
    const desktopSpacing = borderless ? undefined : (dense ? 'p-3 gap-2' : 'p-6 gap-4');
    const panelClass = isMobile
        ? 'w-full h-full flex flex-col p-4 overflow-hidden'
        : cn(
            desktopBase,
            hasMaxWOverride ? undefined : 'max-w-lg',
            desktopSpacing,
            className,
        );

    // On mobile, close button is always shown (no backdrop to tap)
    const showCloseBtn = isMobile || !!title;
    const closeDisabled = isMobile ? false : !!disableClose;

    return ReactDOM.createPortal(
        <div
            id={id}
            data-testid="dialog-overlay"
            className={overlayClass}
            onClick={isMobile ? undefined : (onMinimize ?? onClose)}
            onMouseDown={e => e.stopPropagation()}
            style={hidden ? { display: 'none' } : undefined}
            aria-hidden={hidden || undefined}
        >
            <div
                ref={panelRef}
                role={trapFocus ? 'dialog' : undefined}
                aria-modal={trapFocus ? true : undefined}
                aria-label={trapFocus ? title : undefined}
                tabIndex={trapFocus ? -1 : undefined}
                className={isMobile ? panelClass : panelClass}
                onClick={e => e.stopPropagation()}
            >
                {renderHeader
                    ? renderHeader()
                    : (showCloseBtn && (
                    <div className="flex items-center gap-2">
                        {title && <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{title}</h2>}
                        {onMinimize && (
                            <button
                                data-testid="dialog-minimize-btn"
                                className="ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1"
                                onClick={onMinimize}
                                aria-label="Minimize"
                                title="Minimize"
                            >
                                −
                            </button>
                        )}
                        <button
                            data-testid="dialog-close-btn"
                            className={cn(
                                !onMinimize && !title && 'ml-auto',
                                !onMinimize && title && 'ml-auto',
                                'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1',
                                closeDisabled && 'pointer-events-none opacity-40'
                            )}
                            onClick={closeDisabled ? undefined : onClose}
                            aria-label="Close"
                            title="Close"
                            disabled={closeDisabled}
                        >
                            ×
                        </button>
                    </div>
                ))}
                <div className={cn('text-sm text-[#1e1e1e] dark:text-[#cccccc] flex-1 min-h-0 overflow-y-auto')}>{children}</div>
                {footer && (
                    <div className="flex justify-end gap-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        portalContainer
    );
}
