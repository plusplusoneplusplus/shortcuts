import type { ReactNode, MouseEventHandler } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export interface ButtonProps {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    id?: string;
    'data-testid'?: string;
    'aria-label'?: string;
    title?: string;
    disabled?: boolean;
    loading?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    type?: 'button' | 'submit' | 'reset';
    className?: string;
    children?: ReactNode;
}

const variantMap = {
    primary: 'bg-[#0078d4] text-white hover:bg-[#106ebe] dark:bg-[#0078d4] dark:hover:bg-[#1484d4]',
    secondary: 'bg-transparent border border-[#e0e0e0] text-[#1e1e1e] hover:bg-black/[0.04] dark:border-[#3c3c3c] dark:text-[#cccccc] dark:hover:bg-white/[0.04]',
    danger: 'bg-[#f14c4c] text-white hover:bg-[#d43232] dark:bg-[#f48771] dark:hover:bg-[#f07060]',
    ghost: 'bg-transparent text-[#0078d4] hover:bg-[#0078d4]/10 dark:hover:bg-[#0078d4]/20',
};

const sizeMap = {
    sm: 'px-2 py-1 text-xs rounded       min-h-[44px] md:min-h-0',
    md: 'px-3 py-1.5 text-sm rounded-md  min-h-[44px] md:min-h-0',
    lg: 'px-4 py-2 text-base rounded-md  min-h-[44px] md:min-h-0',
};

export function Button(props: ButtonProps) {
    const {
        variant = 'primary',
        size = 'md',
        id,
        title,
        disabled,
        loading,
        onClick,
        type = 'button',
        className,
        children,
    } = props;
    return (
        <button
            id={id}
            data-testid={props['data-testid']}
            aria-label={props['aria-label']}
            title={title}
            type={type}
            onClick={onClick}
            disabled={disabled || loading}
            className={cn(
                'inline-flex items-center gap-1.5 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4] disabled:opacity-50 disabled:cursor-not-allowed',
                variantMap[variant],
                sizeMap[size],
                className
            )}
        >
            {loading && <Spinner size="sm" />}
            {children}
        </button>
    );
}
