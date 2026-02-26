import type { ReactNode } from 'react';
import { cn } from './cn';

export interface BadgeProps {
    status: string;
    children?: ReactNode;
    className?: string;
    id?: string;
}

const statusMap: Record<string, string> = {
    running: 'bg-[#0078d4]/15 text-[#0078d4] dark:text-[#3794ff] animate-pulse',
    queued: 'bg-[#848484]/15 text-[#848484]',
    completed: 'bg-[#16825d]/15 text-[#16825d] dark:text-[#89d185]',
    failed: 'bg-[#f14c4c]/15 text-[#f14c4c] dark:text-[#f48771]',
    cancelled: 'bg-[#e8912d]/15 text-[#e8912d] dark:text-[#cca700]',
    warning: 'bg-[#f59e0b]/15 text-[#f59e0b] dark:text-[#fbbf24]',
};

export function Badge({ status, children, className, id }: BadgeProps) {
    return (
        <span id={id}
            className={cn(
                'inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded',
                statusMap[status] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                className
            )}
        >
            {children ?? status}
        </span>
    );
}
