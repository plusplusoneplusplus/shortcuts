/**
 * WorkingTreeFileDiff — right-panel detail view for a working-tree file diff.
 *
 * Fetches staged or unstaged diff for a single file via
 * GET /api/workspaces/:id/git/changes/files/<path>/diff?stage=<stage>
 * and renders it in UnifiedDiffViewer. Untracked files show a placeholder.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { UnifiedDiffViewer } from './UnifiedDiffViewer';

export interface WorkingTreeFileDiffProps {
    workspaceId: string;
    filePath: string;
    stage: 'staged' | 'unstaged' | 'untracked';
}

const STAGE_LABEL: Record<string, string> = {
    staged: 'Staged diff',
    unstaged: 'Unstaged diff',
    untracked: 'Untracked file',
};

export function WorkingTreeFileDiff({ workspaceId, filePath, stage }: WorkingTreeFileDiffProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchDiff = useCallback(() => {
        if (stage === 'untracked') {
            setLoading(false);
            setDiff(null);
            setError(null);
            return;
        }
        setLoading(true);
        setError(null);
        setDiff(null);
        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/changes/files/${encodeURIComponent(filePath)}/diff?stage=${stage}`
        )
            .then(data => setDiff(data.diff ?? ''))
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, filePath, stage]);

    useEffect(() => {
        fetchDiff();
    }, [fetchDiff]);

    return (
        <div className="working-tree-file-diff flex flex-col h-full overflow-y-auto" data-testid="working-tree-file-diff">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="working-tree-file-diff-header">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1 truncate font-mono">{filePath}</span>
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">{STAGE_LABEL[stage]}</span>
                </div>
            </div>

            {/* Diff view */}
            <div className="px-4 py-3 flex-1 min-h-0" data-testid="working-tree-file-diff-section">
                {stage === 'untracked' ? (
                    <div className="text-xs text-[#848484] italic" data-testid="working-tree-file-diff-untracked">
                        Untracked file – no diff available
                    </div>
                ) : loading ? (
                    <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="working-tree-file-diff-loading">
                        <Spinner size="sm" /> Loading diff...
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2" data-testid="working-tree-file-diff-error">
                        <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                        <Button variant="secondary" size="sm" onClick={fetchDiff} data-testid="working-tree-file-diff-retry-btn">Retry</Button>
                    </div>
                ) : diff ? (
                    <UnifiedDiffViewer diff={diff} fileName={filePath} data-testid="working-tree-file-diff-content" />
                ) : (
                    <div className="text-xs text-[#848484]" data-testid="working-tree-file-diff-empty">(no changes)</div>
                )}
            </div>
        </div>
    );
}
