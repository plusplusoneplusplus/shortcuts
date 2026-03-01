/**
 * CommitDetail — right-panel detail view for a selected commit.
 *
 * Shows commit subject header, metadata, changed files list, and the
 * full unified diff. Diff is always fetched on mount (no toggle).
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { copyToClipboard } from '../utils/format';

export interface CommitDetailProps {
    workspaceId: string;
    hash: string;
    subject: string;
    author: string;
    date: string;
    parentHashes: string[];
}

interface FileChange {
    status: string;
    path: string;
}

const STATUS_LABELS: Record<string, string> = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    T: 'Type changed',
};

const STATUS_COLORS: Record<string, string> = {
    A: 'text-[#16825d]',
    M: 'text-[#0078d4]',
    D: 'text-[#d32f2f]',
};

export function CommitDetail({ workspaceId, hash, subject, author, date, parentHashes }: CommitDetailProps) {
    const [files, setFiles] = useState<FileChange[]>([]);
    const [filesLoading, setFilesLoading] = useState(true);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [diff, setDiff] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(true);
    const [diffError, setDiffError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setFilesLoading(true);
        setFilesError(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files`)
            .then(data => setFiles(data.files || []))
            .catch(err => setFilesError(err.message || 'Failed to load files'))
            .finally(() => setFilesLoading(false));
    }, [workspaceId, hash]);

    // Always fetch diff on mount / hash change
    useEffect(() => {
        setDiffLoading(true);
        setDiffError(null);
        setDiff(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`)
            .then(data => setDiff(data.diff || ''))
            .catch(err => setDiffError(err.message || 'Failed to load diff'))
            .finally(() => setDiffLoading(false));
    }, [workspaceId, hash]);

    const handleCopyHash = () => {
        copyToClipboard(hash).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleRetryDiff = useCallback(() => {
        setDiffLoading(true);
        setDiffError(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`)
            .then(data => setDiff(data.diff || ''))
            .catch(err => setDiffError(err.message || 'Failed to load diff'))
            .finally(() => setDiffLoading(false));
    }, [workspaceId, hash]);

    const formattedDate = (() => {
        try { return new Date(date).toLocaleString(); } catch { return date; }
    })();

    return (
        <div className="commit-detail flex flex-col h-full overflow-y-auto" data-testid="commit-detail">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="commit-detail-header">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1 truncate">{subject}</span>
                    <span className="font-mono text-xs bg-[#e8e8e8] dark:bg-[#3c3c3c] px-2 py-0.5 rounded text-[#0078d4] dark:text-[#3794ff] flex-shrink-0">{hash.substring(0, 8)}</span>
                    <Button variant="secondary" size="sm" onClick={handleCopyHash} data-testid="copy-hash-btn">
                        {copied ? 'Copied!' : 'Copy Hash'}
                    </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[#616161] dark:text-[#999]">
                    <span>Author: <strong className="text-[#1e1e1e] dark:text-[#ccc]">{author}</strong></span>
                    <span>Date: {formattedDate}</span>
                    {parentHashes.length > 0 && (
                        <span>Parents: {parentHashes.map(p => p.substring(0, 7)).join(', ')}</span>
                    )}
                </div>
            </div>

            {/* Files list */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                {filesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="files-loading">
                        <Spinner size="sm" /> Loading files...
                    </div>
                ) : filesError ? (
                    <div className="text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="files-error">{filesError}</div>
                ) : files.length === 0 ? (
                    <div className="text-xs text-[#848484]" data-testid="no-files-changed">No files changed</div>
                ) : (
                    <div data-testid="file-change-list">
                        <div className="text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                            {files.length} file{files.length !== 1 ? 's' : ''} changed
                        </div>
                        <div className="flex flex-col gap-0.5">
                            {files.map((f, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                                    <span
                                        className={`font-mono font-bold w-4 text-center ${STATUS_COLORS[f.status] || 'text-[#848484]'}`}
                                        title={STATUS_LABELS[f.status] || f.status}
                                    >
                                        {f.status}
                                    </span>
                                    <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] break-all">{f.path}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

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
                    <pre className="p-3 text-xs font-mono bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-x-auto whitespace-pre" data-testid="diff-content">
                        {diff}
                    </pre>
                ) : (
                    <div className="text-xs text-[#848484]" data-testid="diff-empty">(empty diff)</div>
                )}
            </div>
        </div>
    );
}
