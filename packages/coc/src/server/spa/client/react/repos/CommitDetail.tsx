/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows commit metadata (subject, author, date, hash, parents, body) in a
 * header section, followed by the unified diff for the full commit or a
 * single file. Metadata props are optional; when absent the header is hidden.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { UnifiedDiffViewer } from './UnifiedDiffViewer';
import { copyToClipboard } from '../utils/format';

export interface CommitDetailProps {
    workspaceId: string;
    hash: string;
    filePath?: string;
    subject?: string;
    author?: string;
    date?: string;
    parentHashes?: string[];
    body?: string;
}

export function CommitDetail({ workspaceId, hash, filePath, subject, author, date, parentHashes, body }: CommitDetailProps) {
    const [diff, setDiff] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(true);
    const [diffError, setDiffError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [bodyExpanded, setBodyExpanded] = useState(false);

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

    const handleCopyHash = useCallback(() => {
        copyToClipboard(hash).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [hash]);

    const formattedDate = (() => {
        if (!date) return null;
        try { return new Date(date).toLocaleString(); } catch { return date; }
    })();

    const hasMetadata = subject || author || date;

    const bodyLines = body ? body.split('\n') : [];
    const bodyNeedsCollapse = bodyLines.length > 3;
    const displayedBody = bodyNeedsCollapse && !bodyExpanded
        ? bodyLines.slice(0, 3).join('\n')
        : body;

    return (
        <div className="commit-detail flex flex-col h-full overflow-y-auto" data-testid="commit-detail">
            {/* Diff label */}
            {filePath && (
                <div className="px-4 py-2 text-xs font-mono text-[#616161] dark:text-[#999] border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="diff-file-path">
                    {filePath}
                </div>
            )}

            {/* Commit metadata header */}
            {hasMetadata && (
                <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="commit-info-header">
                    {subject && (
                        <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] mb-2 break-words" data-testid="commit-info-subject">
                            {subject}
                        </div>
                    )}
                    <div className="flex flex-col gap-1 text-[11px] text-[#616161] dark:text-[#999]" data-testid="commit-info-metadata">
                        {author && (
                            <div data-testid="commit-info-author">
                                <span className="mr-1">👤</span>Author: <strong className="text-[#1e1e1e] dark:text-[#ccc]">{author}</strong>
                            </div>
                        )}
                        {formattedDate && (
                            <div data-testid="commit-info-date">Date: {formattedDate}</div>
                        )}
                        <div className="flex items-center gap-1" data-testid="commit-info-hash">
                            Hash: <span className="font-mono text-[#0078d4] dark:text-[#3794ff]">{hash.substring(0, 8)}</span>
                            <Button variant="secondary" size="sm" onClick={handleCopyHash} data-testid="commit-info-copy-hash-btn">
                                {copied ? 'Copied!' : 'Copy'}
                            </Button>
                        </div>
                        {parentHashes && parentHashes.length > 0 && (
                            <div data-testid="commit-info-parents">Parents: <span className="font-mono">{parentHashes.map(p => p.substring(0, 7)).join(', ')}</span></div>
                        )}
                    </div>
                    {body && (
                        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-2 mt-2" data-testid="commit-info-body">
                            <pre className="text-[11px] text-[#1e1e1e] dark:text-[#ccc] whitespace-pre-wrap font-sans leading-relaxed m-0">{displayedBody}</pre>
                            {bodyNeedsCollapse && (
                                <button
                                    className="text-[11px] text-[#0078d4] dark:text-[#3794ff] mt-1 cursor-pointer bg-transparent border-none p-0"
                                    onClick={() => setBodyExpanded(!bodyExpanded)}
                                    data-testid="commit-info-body-toggle"
                                >
                                    {bodyExpanded ? 'Show less' : 'Show more…'}
                                </button>
                            )}
                        </div>
                    )}
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
                    <UnifiedDiffViewer diff={diff} data-testid="diff-content" />
                ) : (
                    <div className="text-xs text-[#848484]" data-testid="diff-empty">(empty diff)</div>
                )}
            </div>
        </div>
    );
}
