/**
 * Admin row primitives — shared presentational controls for settings surfaces.
 *
 * Extracted from `AdminPanel.tsx` so other admin-shell views (e.g. the Dreams
 * tab) can render the same Linear-inspired rows/toggles/segments without
 * duplicating markup. Visuals come from `admin-redesign.css`; these components
 * are pure and carry no behaviour of their own.
 */

import type { ReactNode } from 'react';

export function SourceBadge({ source, isDefault }: { source?: string; isDefault?: boolean }) {
    const s = source || 'default';
    const variant =
        s === 'cli' ? 'ar-src-cli' :
            s === 'env' ? 'ar-src-env' :
                s === 'file' || s === 'config' ? 'ar-src-config' :
                    '';
    const modifiedClass = isDefault === false ? ' ar-src-modified' : '';
    const label = isDefault === false ? 'modified' : s;
    const title = isDefault === false
        ? `Value differs from the built-in default (source: ${s})`
        : `Source: ${s}`;
    return <span className={`ar-src ${variant}${modifiedClass}`.trim()} title={title}>{label}</span>;
}

export interface AdminRowProps {
    name: ReactNode;
    hint?: ReactNode;
    children: ReactNode;
    'data-testid'?: string;
}
export function AdminRow({ name, hint, children, 'data-testid': dataTestId }: AdminRowProps) {
    return (
        <div className="ar-row" data-testid={dataTestId}>
            <div className="ar-label-block">
                <div className="ar-name">{name}</div>
                {hint && <div className="ar-hint">{hint}</div>}
            </div>
            <div className="ar-control">{children}</div>
        </div>
    );
}

export interface AdminToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    'data-testid'?: string;
    'aria-label'?: string;
}
export function AdminToggle({ checked, onChange, disabled, 'data-testid': dataTestId, 'aria-label': ariaLabel }: AdminToggleProps) {
    return (
        <label className="ar-toggle">
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange(e.target.checked)}
                data-testid={dataTestId}
                aria-label={ariaLabel}
            />
            <span className="ar-track" />
            <span className="ar-knob" />
        </label>
    );
}

interface AdminSegOption<T extends string | number> {
    value: T;
    label: string;
    testId?: string;
}
export interface AdminSegProps<T extends string | number> {
    value: T;
    onChange: (value: T) => void;
    options: ReadonlyArray<AdminSegOption<T>>;
    'aria-label'?: string;
}
export function AdminSeg<T extends string | number>({ value, onChange, options, 'aria-label': ariaLabel }: AdminSegProps<T>) {
    return (
        <div className="ar-seg" role="group" aria-label={ariaLabel}>
            {options.map(opt => (
                <button
                    key={String(opt.value)}
                    type="button"
                    className={value === opt.value ? 'is-on' : ''}
                    aria-pressed={value === opt.value}
                    onClick={() => onChange(opt.value)}
                    data-testid={opt.testId}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

interface AdminInputSuffixProps {
    suffix: string;
    children: ReactNode;
}
export function AdminInputSuffix({ suffix, children }: AdminInputSuffixProps) {
    return (
        <span className="ar-input-suffix">
            {children}
            <span className="ar-suffix">{suffix}</span>
        </span>
    );
}
