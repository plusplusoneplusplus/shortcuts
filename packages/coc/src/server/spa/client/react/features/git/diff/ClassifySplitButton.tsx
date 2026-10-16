import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ClassifyDiffAiControls } from './ClassifyDiffAiControls';
import { CommitDetailIcon } from '../commits/CommitDetailIcon';
import type { UseClassificationReturn } from './useClassification';
import type { UseModalJobAiSelectionResult } from '../../../shared/ModalJobAiControls';

/** Short provider · effort/model summary shown on the split-button caret. */
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
    const [shift, setShift] = useState(0);
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
            if (rootRef.current?.contains(target) || target?.closest?.('[role=listbox]')) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    // Keep the popover inside the clipped review container in narrow panes.
    useLayoutEffect(() => {
        if (!open) { setShift(0); return; }
        const popover = popoverRef.current?.getBoundingClientRect();
        const bounds = rootRef.current?.closest('.git-file-review')?.getBoundingClientRect();
        if (popover && bounds && popover.right > bounds.right - 4) setShift(Math.min(popover.left - bounds.left - 4, popover.right - bounds.right + 4));
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
            aria-controls={open ? id : undefined} aria-label="Classification settings" title={`Classification settings · ${summary}`}
            data-testid={`${testIdPrefix}-classify-settings-toggle`}>
            <span className="git-review-wide max-w-[160px] truncate" data-testid={`${testIdPrefix}-classify-summary`}>{summary}</span>
            <CommitDetailIcon name={open ? 'up' : 'down'} />
        </button>
        {open && <div ref={popoverRef} id={id} role="dialog" aria-label="Classification settings" className="git-review-popover"
            style={shift ? { transform: `translateX(-${shift}px)` } : undefined} data-testid={`${testIdPrefix}-classify-settings`}
            onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setOpen(false); caretRef.current?.focus(); } }}>
            <ClassifyDiffAiControls selection={aiSelection} disabled={loading} testIdPrefix={`${testIdPrefix}-classify`} />
        </div>}
    </div>;
}
