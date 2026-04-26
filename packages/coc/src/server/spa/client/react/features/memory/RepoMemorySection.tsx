/**
 * RepoMemorySection — top-level memory section for the repo settings tab.
 *
 * Shows two sub-tabs:
 *   1. Bounded Memory — the MEMORY.md viewer/editor
 *   2. Raw Records   — read-only browser for raw-memory.db
 */

import { useState } from 'react';
import { SegmentedControl } from '../../ui';
import { BoundedMemoryTab } from './BoundedMemoryTab';
import { RawMemoryViewer } from './RawMemoryViewer';

type MemorySubTab = 'bounded' | 'raw';

const SUB_TAB_OPTIONS = [
    { value: 'bounded' as const, label: 'Bounded Memory', testId: 'memory-tab-bounded' },
    { value: 'raw' as const, label: 'Raw Records', testId: 'memory-tab-raw' },
] as const;

interface RepoMemorySectionProps {
    repoId: string;
    repoPath?: string;
}

export function RepoMemorySection({ repoId }: RepoMemorySectionProps) {
    const [subTab, setSubTab] = useState<MemorySubTab>('bounded');

    return (
        <div data-testid="repo-memory-section">
            <div className="mb-3">
                <SegmentedControl
                    options={SUB_TAB_OPTIONS}
                    value={subTab}
                    onChange={setSubTab}
                    data-testid="memory-sub-tabs"
                />
            </div>

            {subTab === 'bounded' && <BoundedMemoryTab repoId={repoId} />}
            {subTab === 'raw' && <RawMemoryViewer repoId={repoId} />}
        </div>
    );
}
