import type { ReactNode, MouseEventHandler } from 'react';
import { cn } from './cn';

export interface CardProps {
    className?: string;
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
}

export function Card({ className, children, onClick }: CardProps) {
    return (
        <div
            onClick={onClick}
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
