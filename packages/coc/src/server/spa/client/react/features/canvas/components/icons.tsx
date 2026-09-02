/** Matches ChatHeader's ICON_BTN_CLASS for visual consistency. */
export const ICON_BTN_CLASS =
    'inline-flex items-center justify-center w-[26px] h-[26px] rounded text-[#848484] '
    + 'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] '
    + 'disabled:opacity-40 disabled:cursor-not-allowed shrink-0';

export function PopOutIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 2h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function ExpandIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function CollapseIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function CloseIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function ChevronDownIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
