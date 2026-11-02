import { createContext, forwardRef, type MouseEvent, type ReactNode } from 'react';
import './sentinelAutomationCard.css';

/**
 * The hosted To-do view supplies its existing detail column; standalone cards measure their own width.
 * Keys are Refrain IDs or {@link CODA_DETAIL_KEY}.
 */
export const RefrainHistoryHostContext = createContext<{
    target: HTMLDivElement | null; wide: boolean; activeJobId: string | null; detailOpen: boolean;
    select: (jobId: string) => void; leave: (jobId: string, clear: boolean) => void;
} | null>(null);
/** Refrain IDs are UUIDs, so the built-in row cannot collide with one. */
export const CODA_DETAIL_KEY = 'coda';

/** The card's one interactive selection target; it holds no other controls. */
export const AutomationTitleButton = forwardRef<HTMLButtonElement, {
    name: string; selected: boolean; controls?: string; onSelect: () => void; children: ReactNode;
}>(function AutomationTitleButton({ name, selected, controls, onSelect, children }, ref) {
    return <button ref={ref} type="button" className="sentinel-automation-title-button" aria-pressed={selected}
        aria-controls={controls} aria-label={`Show details for ${name}`} title="Show details" onClick={onSelect}>{children}</button>;
});

const CARD_CONTROLS = 'button, a, input, select, textarea, label, summary, details, form, fieldset, pre, [role="region"], [role="dialog"]';
/**
 * A click on the card's own text or padding selects it. Controls, disclosures and portaled
 * detail content (whose React events still bubble here) keep their own behavior.
 */
export function selectCardOnClick(event: MouseEvent<HTMLElement>, select: () => void) {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    const control = target.closest(CARD_CONTROLS);
    if (control && event.currentTarget.contains(control)) return;
    if (window.getSelection()?.toString()) return;
    select();
}

/** Native disclosures keep secondary actions in the tab order only while open. */
export function AutomationActions({ name, children }: { name: string; children: ReactNode }) {
    return <details className="sentinel-automation-actions" onKeyDown={event => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
        }
    }}>
        <summary aria-label={`More actions for ${name}`}>More <span aria-hidden="true">▾</span></summary>
        <div className="sentinel-automation-secondary">{children}</div>
    </details>;
}

/** The preview is bounded; the complete selectable error remains available without a tooltip. */
export function AutomationError({ label, error }: { label: string; error: string }) {
    const preview = error.replace(/\s+/g, ' ').slice(0, 100);
    return <details className="sentinel-automation-error">
        <summary aria-label={`${label}. Show full error`}><span>{label}: {preview}{error.length > 100 ? '…' : ''}</span></summary>
        <pre role="region" tabIndex={0} aria-label="Full error">{error}</pre>
    </details>;
}
