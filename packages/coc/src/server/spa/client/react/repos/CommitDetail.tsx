/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows only the unified diff for the full commit or a single file.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { UnifiedDiffViewer } from './UnifiedDiffViewer';

export interface CommitDetailProps {
    workspaceId: string;
    hash: string;
    filePath?: string;
}

export function CommitDetail({ workspaceId, hash, filePath }: CommitDetailProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(true);
    const [diffError, setDiffError] = useState<string | null>(null);

    const diffUrl = filePath
        ? `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files/${encodeURIComponent(filePath)}/diff`
        : `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`;

    // Always fetch diff on mount / hash / filePath change
    useEffect(() => {
        setDiffLoading(true);
        setDiffError(null);
        setDiff(null);
        fetchApi(diffUrl)
            .then(data => setDiff(data.diff || ''))
            .catch(err => setDiffError(err.message || 'Failed to load diff'))
            .finally(() => setDiffLoading(false));
    }, [diffUrl]);

    const handleRetryDiff = useCallback(() => {
        setDiffLoading(true);
        setDiffError(null);
        fetchApi(diffUrl)
            .then(data => setDiff(data.diff || ''))
            .catch(err => setDiffError(err.message || 'Failed to load diff'))
            .finally(() => setDiffLoading(false));
    }, [diffUrl]);

    return (
        <div className="commit-detail flex flex-col h-full overflow-y-auto" data-testid="commit-detail">
            {/* Diff label */}
            {filePath && (
                <div className="px-4 py-2 text-xs font-mono text-[#616161] dark:text-[#999] border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="diff-file-path">
                    {filePath}
                </div>
            )}

            {/* Diff view — always visible */}
            <div className="px-4 py-3 flex-1 min-h-0" data-testid="diff-section">
                {diffLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="diff-loading">
                        <Spinner size="sm" /> Loading diff...
                    </div>
                ) : diffError ? (
                    <div className="flex items-center gap-2" data-testid="diff-error">
                        <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{diffError}</span>
                        <Button variant="secondary" size="sm" onClick={handleRetryDiff} data-testid="retry-diff-btn">Retry</Button>
                    </div>
                ) : diff ? (
                    <UnifiedDiffViewer diff={diff} fileName={filePath} data-testid="diff-content" />
                ) : (
                    <div className="text-xs text-[#848484]" data-testid="diff-empty">(empty diff)</div>
                )}
            </div>
        </div>
    );
}
