/**
 * RepoMemorySection — top-level memory section for the repo settings tab.
 *
 * Shows the bounded MEMORY.md viewer/editor for the repo.
 */

import React from 'react';
import { BoundedMemoryTab } from './BoundedMemoryTab';

interface RepoMemorySectionProps {
    repoId: string;
    repoPath?: string;
}

export function RepoMemorySection({ repoId }: RepoMemorySectionProps) {
    return (
        <div data-testid="repo-memory-section">
            <BoundedMemoryTab repoId={repoId} />
        </div>
    );
}
