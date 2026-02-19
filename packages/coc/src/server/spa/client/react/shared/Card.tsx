import type { ReactNode, MouseEventHandler } from 'react';
import { cn } from './cn';

export interface CardProps {
    className?: string;
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
    'aria-label'?: string;
}

export function Card({ className, children, onClick, 'aria-label': ariaLabel }: CardProps) {
    return (
        <div
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            aria-label={ariaLabel}
            onClick={onClick}
            onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(e as any) : undefined}
            className={cn(
                'rounded-md border border-[#e0e0e0] bg-[#f3f3f3] dark:border-[#3c3c3c] dark:bg-[#252526] overflow-hidden transition-colors',
                onClick && 'cursor-pointer hover:border-[#0078d4] dark:hover:border-[#3794ff]',
                className
            )}
        >
            {children}
        </div>
    );
}
