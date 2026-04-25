/** Inline SVG icons for the scratchpad divider bar. 16×16, currentColor. */

interface IconProps {
    className?: string;
}

export function ChevronUpIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 10 8 6 12 10" />
        </svg>
    );
}

export function ChevronDownIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 6 8 10 12 6" />
        </svg>
    );
}

export function ChevronLeftIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="10 4 6 8 10 12" />
        </svg>
    );
}

export function ChevronRightIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 4 10 8 6 12" />
        </svg>
    );
}

export function SplitIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="1" />
            <line x1="8" y1="2" x2="8" y2="14" />
        </svg>
    );
}

export function CloseIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
    );
}

export function GripDotsIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            {/* 2×3 dot grid */}
            <circle cx="6" cy="4" r="1.2" />
            <circle cx="10" cy="4" r="1.2" />
            <circle cx="6" cy="8" r="1.2" />
            <circle cx="10" cy="8" r="1.2" />
            <circle cx="6" cy="12" r="1.2" />
            <circle cx="10" cy="12" r="1.2" />
        </svg>
    );
}

export function GripDotsHorizontalIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            {/* 3×2 dot grid (horizontal variant for vertical divider) */}
            <circle cx="4" cy="6" r="1.2" />
            <circle cx="8" cy="6" r="1.2" />
            <circle cx="12" cy="6" r="1.2" />
            <circle cx="4" cy="10" r="1.2" />
            <circle cx="8" cy="10" r="1.2" />
            <circle cx="12" cy="10" r="1.2" />
        </svg>
    );
}

export function FileIcon({ className }: IconProps) {
    return (
        <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6L9 2Z" />
            <polyline points="9 2 9 6 13 6" />
        </svg>
    );
}
