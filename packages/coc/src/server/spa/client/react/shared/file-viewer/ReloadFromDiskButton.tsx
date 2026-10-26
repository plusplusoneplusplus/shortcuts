/**
 * ReloadFromDiskButton — the file editor's "Reload from disk" icon control.
 *
 * One control for every host of `PreviewPane`: the unified panel's breadcrumb
 * toolbar and the floating toolbar of hosts without one. It re-reads the open
 * file's source text, never the page or the server.
 */

import { cn } from '../../ui/cn';

export interface ReloadFromDiskButtonProps {
    onReload: () => void;
    /** A reload, its confirmation, or a save is in progress. */
    busy?: boolean;
    className?: string;
}

export const RELOAD_FROM_DISK_LABEL = 'Reload from disk';

export function ReloadFromDiskButton({ onReload, busy = false, className }: ReloadFromDiskButtonProps) {
    return (
        <button
            type="button"
            aria-label={RELOAD_FROM_DISK_LABEL}
            title={RELOAD_FROM_DISK_LABEL}
            aria-busy={busy}
            disabled={busy}
            onClick={onReload}
            data-testid="file-reload-from-disk"
            className={cn(
                'flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0',
                'text-[#616161] hover:text-[#1f1f1f] focus-visible:outline-none focus-visible:ring-1',
                'focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:text-[#9d9d9d] dark:hover:text-white',
                'dark:focus-visible:ring-[#3794ff] disabled:cursor-default disabled:opacity-50',
                className,
            )}
        >
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={busy ? 'animate-spin' : undefined}
                aria-hidden
            >
                <path d="M20 11a8 8 0 1 0-2.34 5.66" />
                <path d="M20 4v7h-7" />
            </svg>
        </button>
    );
}
