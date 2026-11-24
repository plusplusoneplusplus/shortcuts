import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClassifyDiffAiControls } from './ClassifyDiffAiControls';
import { CommitDetailIcon } from '../commits/CommitDetailIcon';
import type { UseClassificationReturn } from './useClassification';
import type { UseModalJobAiSelectionResult } from '../../../shared/ModalJobAiControls';

/** Short provider · effort/model summary exposed on the split-button caret's label and tooltip. */
export function classifySettingsSummary(selection: UseModalJobAiSelectionResult): string {
    const provider = selection.agentProviders.find(p => p.id === selection.provider)?.label ?? selection.provider;
    const detail = selection.useEffortTierMode
        ? selection.selectedEffortTier.replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator ? ' ' : ''}${letter.toUpperCase()}`)
        : selection.validModelOverride || selection.defaultModelLabel || 'Default model';
    return `${provider} · ${detail}`;
}

/**
 * Classify split button: the main part runs classification with the saved
 * workspace selection; the caret opens the provider/effort settings popover.
 * Remount (via the owning review's key) resets the popover.
 */
export function ClassifySplitButton({ classification, aiSelection, testIdPrefix }: {
    classification: UseClassificationReturn;
    aiSelection: UseModalJobAiSelectionResult;
    testIdPrefix: string;
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ width: 0, left: 0, top: 0 });
    const id = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const caretRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const loading = classification.state.status === 'loading';
    const label = loading ? 'Classifying…' : classification.state.status === 'ready' ? 'Re-classify' : 'Classify';
    const summary = classifySettingsSummary(aiSelection);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            const target = event.target as Element | null;
            // Provider/effort menus portal outside the popover.
            if (rootRef.current?.contains(target) || popoverRef.current?.contains(target) || target?.closest?.('[role=listbox], [aria-label="Effort tier settings"]')) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    // Escape clipping ancestors and track the right-hand trigger as the pane resizes.
    useLayoutEffect(() => {
        if (!open) return;
        const review = rootRef.current?.closest('.git-file-review');
        const update = () => {
            const anchor = rootRef.current?.getBoundingClientRect();
            const popover = popoverRef.current?.getBoundingClientRect();
            if (!anchor || !popover) return;
            setPosition({
                width: review?.getBoundingClientRect().width ?? 0,
                left: Math.max(8, Math.min(anchor.right - popover.width, window.innerWidth - popover.width - 8)),
                top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - popover.height - 8)),
            });
        };
        update();
        const observer = new ResizeObserver(update);
        if (review) observer.observe(review);
        if (popoverRef.current) observer.observe(popoverRef.current);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    return <div ref={rootRef} className="git-review-split" data-testid={`${testIdPrefix}-classify-split`}>
        <button type="button" onClick={classification.classify} disabled={loading} aria-label={label}
            title={`${label} · ${summary}`} className={loading ? 'cursor-wait' : undefined} data-testid={`${testIdPrefix}-classify-button`}>
            {loading
                ? <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <CommitDetailIcon name="spark" />}
            <span className="git-review-md">{label}</span>
        </button>
        <button type="button" ref={caretRef} onClick={() => setOpen(value => !value)} aria-haspopup="dialog" aria-expanded={open}
            aria-controls={open ? id : undefined} aria-label={`Classification settings: ${summary}`} title={`Classification settings · ${summary}`}
            data-testid={`${testIdPrefix}-classify-settings-toggle`}>
            <CommitDetailIcon name={open ? 'up' : 'down'} />
        </button>
        {open && createPortal(<div className="git-file-review git-review-menu-layer" style={{ width: position.width }}>
            <div ref={popoverRef} id={id} role="dialog" aria-label="Classification settings" className="git-review-popover"
                style={{ left: position.left, top: position.top }} data-testid={`${testIdPrefix}-classify-settings`}
                onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setOpen(false); caretRef.current?.focus(); } }}>
                <ClassifyDiffAiControls selection={aiSelection} disabled={loading} testIdPrefix={`${testIdPrefix}-classify`} />
            </div>
        </div>, document.body)}
    </div>;
}
