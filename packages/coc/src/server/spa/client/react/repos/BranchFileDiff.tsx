/**
 * BranchFileDiff — right-panel detail view for a single branch file's diff.
 *
 * Mirrors the CommitDetail structure: header bar + unified diff with
 * loading/error/retry states. Fetches the diff for a single file from
 * the branch-range endpoint on mount.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { UnifiedDiffViewer } from './UnifiedDiffViewer';

export interface BranchFileDiffProps {
    workspaceId: string;
    filePath: string;
}

export function BranchFileDiff({ workspaceId, filePath }: BranchFileDiffProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchDiff = useCallback(() => {
        setLoading(true);
        setError(null);
        setDiff(null);
        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files/${encodeURIComponent(filePath)}/diff`
        )
            .then(data => setDiff(data.diff ?? ''))
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, filePath]);

    useEffect(() => {
        fetchDiff();
    }, [fetchDiff]);

    const handleRetry = useCallback(() => {
        fetchDiff();
    }, [fetchDiff]);

    return (
        <div className="branch-file-diff flex flex-col h-full overflow-y-auto" data-testid="branch-file-diff">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="branch-file-diff-header">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1 truncate font-mono">{filePath}</span>
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">Branch diff</span>
                </div>
            </div>

            {/* Diff view */}
            <div className="px-4 py-3 flex-1 min-h-0" data-testid="branch-file-diff-section">
                {loading ? (
                    <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="branch-file-diff-loading">
                        <Spinner size="sm" /> Loading diff...
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2" data-testid="branch-file-diff-error">
                        <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                        <Button variant="secondary" size="sm" onClick={handleRetry} data-testid="branch-file-diff-retry-btn">Retry</Button>
                    </div>
                ) : diff ? (
                    <UnifiedDiffViewer diff={diff} fileName={filePath} data-testid="branch-file-diff-content" />
                ) : (
                    <div className="text-xs text-[#848484]" data-testid="branch-file-diff-empty">(empty diff)</div>
                )}
            </div>
        </div>
    );
}
