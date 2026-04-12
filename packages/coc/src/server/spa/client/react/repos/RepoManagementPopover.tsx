/**
 * RepoManagementPopover — dropdown overlay wrapping the ReposGrid.
 * Opens when the hamburger button is clicked on the repos tab.
 * Closes on outside click or Escape key.
 */

import { useEffect, useRef } from 'react';
import { ReposGrid } from './ReposGrid';
import type { RepoData } from './repoGrouping';

export interface RepoManagementPopoverProps {
    open: boolean;
    onClose: () => void;
    repos: RepoData[];
    onRefresh: () => void;
}

export function RepoManagementPopover({ open, onClose, repos, onRefresh }: RepoManagementPopoverProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const handleMouseDown = (e: MouseEvent) => {
            const target = e.target as Element;
            // Don't close when clicking the hamburger toggle or mobile repo picker button;
            // their own onClick handlers will toggle the popover.
            if (target.id === 'hamburger-btn' || target.closest('#hamburger-btn') ||
                target.id === 'repo-picker-btn' || target.closest('#repo-picker-btn')) {
                return;
            }
            // Don't close when clicking inside a portal-rendered dialog (e.g. AddRepoDialog,
            // AddFolderDialog). These render via createPortal to document.body, so their DOM
            // is outside containerRef even though they are logically children.
            if (target.closest('[data-testid="dialog-overlay"]')) {
                return;
            }
            if (containerRef.current && !containerRef.current.contains(target)) {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleMouseDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            ref={containerRef}
            data-testid="repo-management-popover"
            className="fixed top-10 md:top-12 left-0 z-50 w-[320px] max-h-[70vh] overflow-y-auto rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] shadow-lg"
            role="dialog"
            aria-label="Repository management"
            aria-modal="true"
        >
            <ReposGrid repos={repos} onRefresh={onRefresh} />
        </div>
    );
}
