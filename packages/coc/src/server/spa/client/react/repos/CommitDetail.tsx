/**
 * CommitDetail — expanded view for a single commit.
 *
 * Fetches changed files on mount and optionally loads the full diff.
 */

import { useState, useEffect } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, Button } from '../shared';
import { copyToClipboard } from '../utils/format';

interface CommitDetailProps {
    workspaceId: string;
    hash: string;
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

export function CommitDetail({ workspaceId, hash, author, date, parentHashes }: CommitDetailProps) {
    const [files, setFiles] = useState<FileChange[]>([]);
    const [filesLoading, setFilesLoading] = useState(true);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [diff, setDiff] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
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

    const handleCopyHash = () => {
        copyToClipboard(hash).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleViewDiff = () => {
        if (diff !== null) {
            setDiff(null);
            return;
        }
        setDiffLoading(true);
        setDiffError(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`)
            .then(data => setDiff(data.diff || ''))
            .catch(err => setDiffError(err.message || 'Failed to load diff'))
            .finally(() => setDiffLoading(false));
    };

    const formattedDate = (() => {
        try { return new Date(date).toLocaleString(); } catch { return date; }
    })();

    return (
        <div className="commit-detail px-4 py-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1e1e1e]" data-testid="commit-detail">
            {/* Commit metadata */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#616161] dark:text-[#999] mb-3">
                <span>Author: <strong className="text-[#1e1e1e] dark:text-[#ccc]">{author}</strong></span>
                <span>Date: {formattedDate}</span>
                {parentHashes.length > 0 && (
                    <span>Parents: {parentHashes.map(p => p.substring(0, 7)).join(', ')}</span>
                )}
                <Button variant="secondary" size="sm" onClick={handleCopyHash} data-testid="copy-hash-btn">
                    {copied ? 'Copied!' : 'Copy Hash'}
                </Button>
            </div>

            {/* Files list */}
            {filesLoading ? (
                <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="files-loading">
                    <Spinner size="sm" /> Loading files...
                </div>
            ) : filesError ? (
                <div className="text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="files-error">{filesError}</div>
            ) : (
                <div data-testid="file-change-list">
                    <div className="text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                        {files.length} file{files.length !== 1 ? 's' : ''} changed
                    </div>
                    <div className="flex flex-col gap-0.5 mb-3">
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

            {/* Diff viewer */}
            <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleViewDiff} data-testid="view-diff-btn" disabled={diffLoading}>
                    {diffLoading ? 'Loading...' : diff !== null ? 'Hide Diff' : 'View Full Diff'}
                </Button>
            </div>
            {diffError && (
                <div className="text-xs text-[#d32f2f] dark:text-[#f48771] mt-1" data-testid="diff-error">{diffError}</div>
            )}
            {diff !== null && (
                <pre className="mt-2 p-3 text-xs font-mono bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre" data-testid="diff-content">
                    {diff || '(empty diff)'}
                </pre>
            )}
        </div>
    );
}
