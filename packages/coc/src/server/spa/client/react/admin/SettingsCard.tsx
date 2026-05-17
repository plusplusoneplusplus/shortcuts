/**
 * SettingsCard — reusable wrapper for a category of settings.
 * Renders a titled card with optional description and badge,
 * and a Save/Cancel footer when dirty.
 *
 * Visuals come from `admin-redesign.css` (Linear-inspired). The component
 * keeps its prior public API (title/description/badge/dirty/saving/onSave/
 * onCancel/data-testid) so callers and tests need no changes.
 */

import type { ReactNode } from 'react';
import { Spinner } from '../ui';

export interface SettingsCardProps {
    title?: string;
    description?: string;
    badge?: string;
    dirty?: boolean;
    saving?: boolean;
    onSave?: () => void;
    onCancel?: () => void;
    children: ReactNode;
    'data-testid'?: string;
}

const badgeVariant: Record<string, string> = {
    Global: 'ar-badge-accent',
    Advanced: 'ar-badge-warning',
    Container: 'ar-badge-success',
};

export function SettingsCard({
    title,
    description,
    badge,
    dirty,
    saving,
    onSave,
    onCancel,
    children,
    'data-testid': dataTestId,
}: SettingsCardProps) {
    return (
        <section className="ar-card" data-testid={dataTestId}>
            {(title || description || badge) && (
                <header className="ar-card-head">
                    <div className="min-w-0 flex-1">
                        {title && <h3>{title}</h3>}
                        {description && <p className="ar-card-desc">{description}</p>}
                    </div>
                    {badge && (
                        <div className="ar-badge-row">
                            <span className={`ar-badge ${badgeVariant[badge] ?? ''}`}>{badge}</span>
                        </div>
                    )}
                </header>
            )}
            <div className="ar-card-body">
                {children}
            </div>
            {onSave && (
                <footer className="ar-card-foot">
                    {dirty && (
                        <span className="ar-dirty-note">
                            <span className="ar-dirty-pulse" aria-hidden="true" />
                            Unsaved changes
                        </span>
                    )}
                    {onCancel && (
                        <button
                            type="button"
                            className="ar-btn ar-btn-ghost ar-btn-sm"
                            onClick={onCancel}
                            disabled={saving || !dirty}
                            data-testid={dataTestId ? `${dataTestId}-cancel` : undefined}
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        type="button"
                        className="ar-btn ar-btn-primary ar-btn-sm"
                        onClick={onSave}
                        disabled={!dirty || saving}
                        data-testid={dataTestId ? `${dataTestId}-save` : undefined}
                    >
                        {saving && <Spinner size="sm" />}
                        Save
                    </button>
                </footer>
            )}
        </section>
    );
}
