/**
 * CommitFileContent — right-panel view showing the unified diff of a single
 * file in a commit, with green/red coloring via UnifiedDiffViewer.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button, TruncatedPath } from '../shared';
import { UnifiedDiffViewer, HunkNavButtons } from './UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from './UnifiedDiffViewer';
import { SideBySideDiffViewer } from './SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle } from './DiffViewToggle';
import { DiffMiniMap } from './DiffMiniMap';

export interface CommitFileContentProps {
    workspaceId: string;
    hash: string;
    filePath: string;
}

export function CommitFileContent({ workspaceId, hash, filePath }: CommitFileContentProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [viewMode, setViewMode] = useDiffViewMode();

    const fetchDiff = useCallback(() => {
        setLoading(true);
        setError(null);
        setDiff(null);
        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files/${encodeURIComponent(filePath)}/diff`
        )
            .then(data => setDiff(data.diff ?? ''))
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, hash, filePath]);

    useEffect(() => {
        fetchDiff();
    }, [fetchDiff]);

    return (
        <div className="commit-file-content flex flex-col h-full overflow-hidden" data-testid="commit-file-content">
            <div
                className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]"
                data-testid="commit-file-path"
            >
                <div className="flex items-center gap-2">
                    <TruncatedPath path={filePath} className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                    <HunkNavButtons onPrev={() => viewerRef.current?.scrollToPrevHunk()} onNext={() => viewerRef.current?.scrollToNextHunk()} />
                    <DiffViewToggle mode={viewMode} onChange={setViewMode} />
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">Commit diff</span>
                </div>
            </div>

            <div className="flex flex-1 min-h-0">
                <div ref={scrollContainerRef} className="flex-1 overflow-auto px-1 py-1" data-testid="commit-file-content-body">
                    {loading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="commit-file-content-loading">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2" data-testid="commit-file-content-error">
                            <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                            <Button variant="secondary" size="sm" onClick={fetchDiff}>Retry</Button>
                        </div>
                    ) : diff ? (
                        viewMode === 'split' ? (
                            <SideBySideDiffViewer
                                ref={viewerRef}
                                diff={diff}
                                fileName={filePath}
                                showLineNumbers
                                onLinesReady={(lines) => { setDiffLines(lines); }}
                                data-testid="commit-file-diff-content"
                            />
                        ) : (
                            <UnifiedDiffViewer
                                ref={viewerRef}
                                diff={diff}
                                fileName={filePath}
                                showLineNumbers
                                onLinesReady={(lines) => { setDiffLines(lines); }}
                                data-testid="commit-file-diff-content"
                            />
                        )
                    ) : (
                        <div className="text-xs text-[#848484]" data-testid="commit-file-content-empty">(empty diff)</div>
                    )}
                </div>
                {diff && !loading && !error && (
                    <DiffMiniMap diffLines={diffLines} scrollContainerRef={scrollContainerRef} />
                )}
            </div>
        </div>
    );
}
