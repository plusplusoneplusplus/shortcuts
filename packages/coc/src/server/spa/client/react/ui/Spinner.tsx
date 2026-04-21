import { cn } from './cn';

export interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const sizeMap = {
    sm: 'h-3 w-3 border-[1.5px]',
    md: 'h-4 w-4 border-2',
    lg: 'h-6 w-6 border-2',
};

export function Spinner({ size = 'md', className }: SpinnerProps) {
    return (
        <div
            className={cn(
                'animate-spin rounded-full border-current border-t-transparent',
                sizeMap[size],
                className
            )}
            aria-label="Loading"
        />
    );
}
