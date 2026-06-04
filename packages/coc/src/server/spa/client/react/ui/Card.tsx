import type { ReactNode, MouseEventHandler, TouchEventHandler, DragEventHandler } from 'react';
import { cn } from './cn';

export interface CardProps {
    className?: string;
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
    onContextMenu?: MouseEventHandler<HTMLDivElement>;
    onDragStart?: DragEventHandler<HTMLDivElement>;
    onTouchStart?: TouchEventHandler<HTMLDivElement>;
    onTouchEnd?: TouchEventHandler<HTMLDivElement>;
    onTouchMove?: TouchEventHandler<HTMLDivElement>;
    draggable?: boolean;
    title?: string;
    'aria-label'?: string;
    id?: string;
    'data-wiki-id'?: string;
    'data-task-id'?: string;
    'data-testid'?: string;
    [key: `data-${string}`]: string | boolean | undefined;
}

export function Card({ className, children, onClick, onContextMenu, onDragStart, onTouchStart, onTouchEnd, onTouchMove, draggable, title, 'aria-label': ariaLabel, id, 'data-wiki-id': dataWikiId, 'data-task-id': dataTaskId, 'data-testid': dataTestId, ...rest }: CardProps) {
    // Extract remaining data-* attributes
    const dataAttrs: Record<string, string | boolean | undefined> = {};
    for (const [key, value] of Object.entries(rest)) {
        if (key.startsWith('data-')) dataAttrs[key] = value;
    }

    return (
        <div
            id={id}
            data-wiki-id={dataWikiId}
            data-task-id={dataTaskId}
            data-testid={dataTestId}
            {...dataAttrs}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            aria-label={ariaLabel}
            title={title}
            draggable={draggable}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchMove={onTouchMove}
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
