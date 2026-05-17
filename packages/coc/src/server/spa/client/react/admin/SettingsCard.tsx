/**
 * SettingsCard — reusable wrapper for a category of settings.
 * Renders a titled card with optional description and badge,
 * and a Save/Cancel footer when dirty.
 */

import type { ReactNode } from 'react';
import { Card, Button } from '../ui';

export interface SettingsCardProps {
    title: string;
    description?: string;
    badge?: string;
    dirty?: boolean;
    saving?: boolean;
    onSave?: () => void;
    onCancel?: () => void;
    children: ReactNode;
    'data-testid'?: string;
}

const badgeColors: Record<string, string> = {
    Global: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    Advanced: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    Container: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
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
        <Card className="p-3 md:p-4" data-testid={dataTestId}>
            <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{title}</h3>
                {badge && (
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded font-medium ${badgeColors[badge] ?? badgeColors.Global}`}>
                        {badge}
                    </span>
                )}
            </div>
            {description && (
                <p className="text-xs text-[#616161] dark:text-[#999] mb-3">{description}</p>
            )}
            <div className="space-y-2">
                {children}
            </div>
            {onSave && (
                <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {onCancel && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={onCancel}
                            disabled={saving || !dirty}
                            data-testid={dataTestId ? `${dataTestId}-cancel` : undefined}
                        >
                            Cancel
                        </Button>
                    )}
                    <Button
                        size="sm"
                        onClick={onSave}
                        loading={saving}
                        disabled={!dirty}
                        data-testid={dataTestId ? `${dataTestId}-save` : undefined}
                    >
                        Save
                    </Button>
                </div>
            )}
        </Card>
    );
}
