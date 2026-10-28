import type { ReactNode } from 'react';
import './sentinelAutomationCard.css';

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
