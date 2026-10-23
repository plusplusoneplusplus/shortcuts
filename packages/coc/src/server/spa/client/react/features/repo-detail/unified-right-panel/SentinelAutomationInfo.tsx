import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortalContainer } from '../../../ui/usePortalContainer';
import { useAnchoredPanelPosition } from '../../../shared/useAnchoredPanelPosition';
import { useHoverPopoverDismissal } from '../../chat/conversation/tool-calls/hoverPopover';

const descriptions = {
    Overtures: 'Wakes this Sentinel once when a watched PR merges or at a chosen time. It posts the saved message here; it does not automatically launch work or grant new permission.',
    Refrains: 'Saved prompts you can run on demand or on a schedule. An optional gate decides whether a run should start. Results return to this Sentinel.',
    Coda: 'Reviews job, PR and commit evidence to suggest To-do status changes. Strongly verified Done results may apply automatically; manual and Deferred items need your approval. It does not carry out the tasks.',
};

/** Local help only: opening an explanation never reads or mutates automation state. */
export function SentinelAutomationInfo({ term }: { term: keyof typeof descriptions }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const portal = usePortalContainer(open);
    const dismiss = useCallback(() => setOpen(false), []);
    const close = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);
    useHoverPopoverDismissal(open, triggerRef, panelRef, dismiss, close);
    const position = useAnchoredPanelPosition({ open: open && portal !== null, placement: 'down', align: 'left',
        triggerRef, panelRef, constrainHeight: true, onAnchorHidden: dismiss });
    useEffect(() => {
        if (open && portal) panelRef.current?.focus();
    }, [open, portal]);

    return <span className="inline-flex shrink-0 items-center">
        <button ref={triggerRef} type="button" aria-label={`About ${term}`} aria-haspopup="dialog" aria-expanded={open}
            aria-controls={open ? id : undefined}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#616161] hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#9d9d9d] dark:hover:bg-white/[0.04]"
            onClick={event => { event.stopPropagation(); setOpen(value => !value); }}
            onKeyDown={event => {
                if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <circle cx="8" cy="8" r="6" /><path d="M8 7v4" /><circle cx="8" cy="4.5" r=".7" fill="currentColor" stroke="none" />
            </svg>
        </button>
        {open && portal && createPortal(<div ref={panelRef} id={id} role="dialog" aria-label={`About ${term}`}
            aria-describedby={`${id}-description`} tabIndex={-1} style={position}
            className="fixed z-[10003] w-72 max-w-[calc(100vw-16px)] overflow-auto break-words rounded-md border border-[#e0e0e0] bg-white p-3 text-xs text-[#1e1e1e] shadow-lg [overflow-wrap:anywhere] focus:outline-none dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
            onClick={event => event.stopPropagation()}
            onBlur={event => {
                const next = event.relatedTarget as Node | null;
                if (!event.currentTarget.contains(next) && next !== triggerRef.current) dismiss();
            }}
            onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            }}>
            <div className="mb-1 flex items-center gap-2">
                <strong className="min-w-0 flex-1">{term}</strong>
                <button type="button" aria-label={`Close ${term} information`} onClick={close}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:hover:bg-white/[0.04]">
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            <p id={`${id}-description`}>{descriptions[term]}</p>
        </div>, portal)}
    </span>;
}
