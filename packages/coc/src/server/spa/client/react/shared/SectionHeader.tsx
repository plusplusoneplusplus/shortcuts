import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';

export interface SectionHeaderProps {
    title: string;
    onRefresh?: () => void;
    refreshing?: boolean;
    actions?: ReactNode;
    className?: string;
}

export function SectionHeader({ title, onRefresh, refreshing, actions, className }: SectionHeaderProps) {
    return (
        <div className={cn('flex items-center justify-between', className)}>
            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                {title}
            </h3>
            <div className="flex items-center gap-2">
                {onRefresh && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onRefresh}
                        disabled={refreshing}
                        title={`Refresh ${title}`}
                        data-testid={`${title.toLowerCase().replace(/\s+/g, '-')}-refresh-btn`}
                    >
                        <span className={cn('inline-block', refreshing && 'animate-spin')}>↻</span>
                        {' '}Refresh
                    </Button>
                )}
                {actions}
            </div>
        </div>
    );
}
