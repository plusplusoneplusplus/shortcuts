import type { ReactNode, MouseEventHandler } from 'react';
import { cn } from './cn';

export interface CardProps {
    className?: string;
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
    onContextMenu?: MouseEventHandler<HTMLDivElement>;
    'aria-label'?: string;
    id?: string;
    'data-wiki-id'?: string;
    'data-task-id'?: string;
    'data-testid'?: string;
}

export function Card({ className, children, onClick, onContextMenu, 'aria-label': ariaLabel, id, 'data-wiki-id': dataWikiId, 'data-task-id': dataTaskId, 'data-testid': dataTestId }: CardProps) {
    return (
        <div
            id={id}
            data-wiki-id={dataWikiId}
            data-task-id={dataTaskId}
            data-testid={dataTestId}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            aria-label={ariaLabel}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(e as any) : undefined}
            className={cn(
                'rounded-md border border-[#e0e0e0] bg-[#f3f3f3] dark:border-[#474749] dark:bg-[#2d2d30] overflow-hidden transition-colors',
                onClick && 'cursor-pointer hover:border-[#0078d4] dark:hover:border-[#3794ff]',
                className
            )}
        >
            {children}
        </div>
    );
}
