import React from 'react';
import { Button } from '../ui/Button';

export interface ReposEmptyStateProps {
    onAddRepo: () => void;
    onCloneRepo?: () => void;
    compact?: boolean;
}

function FolderIcon({ size = 40 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            width={size}
            height={size}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
        </svg>
    );
}

export function ReposEmptyState({ onAddRepo, onCloneRepo, compact = false }: ReposEmptyStateProps) {
    if (compact) {
        return (
            <div data-testid="repos-empty-compact" className="flex items-center justify-center py-2">
                <button
                    type="button"
                    onClick={onAddRepo}
                    title="Add repository"
                    aria-label="Add repository"
                    className="text-[#c8c8c8] dark:text-[#555555] hover:text-[#0078d4] dark:hover:text-[#0078d4] transition-colors p-1 rounded"
                >
                    <FolderIcon size={20} />
                </button>
            </div>
        );
    }

    return (
        <div data-testid="repos-empty" className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
            <div className="text-[#c8c8c8] dark:text-[#555555]">
                <FolderIcon size={40} />
            </div>
            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                No repositories yet
            </h3>
            <p className="text-xs text-[#848484]">
                Add a repository to start working with AI workflows.
            </p>
            <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={onAddRepo}>
                    + Add Repository
                </Button>
                {onCloneRepo && (
                    <Button variant="secondary" size="sm" onClick={onCloneRepo}>
                        Clone Repository
                    </Button>
                )}
            </div>
        </div>
    );
}
