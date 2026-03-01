/**
 * BranchChanges — collapsible section showing branch-range analysis data.
 *
 * Surfaces commit count, additions/deletions, and changed files for the
 * current feature branch vs the default branch. Hidden when on the default
 * branch or on any range-fetch error.
 */

import { useState, useEffect } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner } from '../shared';

interface BranchChangesProps {
    workspaceId: string;
}

interface BranchRangeInfo {
    baseRef: string;
    headRef: string;
    commitCount: number;
    additions: number;
    deletions: number;
    mergeBase: string;
    branchName?: string;
    fileCount: number;
}

interface BranchRangeFile {
    path: string;
    status: string;
    additions: number;
    deletions: number;
    oldPath?: string;
}

const STATUS_CHARS: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
};

const STATUS_COLORS: Record<string, string> = {
    added:    'text-[#16825d]',
    modified: 'text-[#0078d4]',
    deleted:  'text-[#d32f2f]',
    renamed:  'text-[#9c27b0]',
    copied:   'text-[#848484]',
};

const STATUS_LABELS: Record<string, string> = {
    added: 'Added',
    modified: 'Modified',
    deleted: 'Deleted',
    renamed: 'Renamed',
    copied: 'Copied',
};

export function BranchChanges({ workspaceId }: BranchChangesProps) {
    const [rangeInfo, setRangeInfo] = useState<BranchRangeInfo | null>(null);
    const [files, setFiles] = useState<BranchRangeFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [filesLoading, setFilesLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [filesError, setFilesError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setHidden(false);
        setRangeInfo(null);
        setFiles([]);
        setExpanded(false);
        setFilesError(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range`)
            .then(data => {
                if (data.onDefaultBranch) {
                    setHidden(true);
                } else {
                    setRangeInfo({
                        baseRef: data.baseRef,
                        headRef: data.headRef,
                        commitCount: data.commitCount,
                        additions: data.additions,
                        deletions: data.deletions,
                        mergeBase: data.mergeBase,
                        branchName: data.branchName,
                        fileCount: Array.isArray(data.files) ? data.files.length : 0,
                    });
                }
            })
            .catch(() => {
                setHidden(true);
            })
            .finally(() => setLoading(false));
    }, [workspaceId]);

    useEffect(() => {
        if (!expanded || files.length > 0 || !rangeInfo) return;
        setFilesLoading(true);
        setFilesError(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files`)
            .then(data => {
                setFiles(data.files || []);
            })
            .catch(err => {
                setFilesError(err.message || 'Failed to load files');
            })
            .finally(() => setFilesLoading(false));
    }, [expanded, files.length, rangeInfo, workspaceId]);

    if (loading || hidden || !rangeInfo) return null;

    const baseShort = rangeInfo.baseRef.replace(/^origin\//, '');
    const branchLabel = rangeInfo.branchName || rangeInfo.headRef;

    return (
        <div className="branch-changes" data-testid="branch-changes">
            <button
                className="w-full flex items-center gap-2 px-4 py-2 bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c] text-left cursor-pointer hover:bg-[#ececec] dark:hover:bg-[#2a2d2e] transition-colors"
                onClick={() => setExpanded(prev => !prev)}
                data-testid="branch-changes-header"
            >
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#616161] dark:text-[#999]">
                        Branch Changes: {branchLabel}
                    </div>
                    <div className="text-xs text-[#616161] dark:text-[#999] mt-0.5" data-testid="branch-changes-summary">
                        {rangeInfo.commitCount} commit{rangeInfo.commitCount !== 1 ? 's' : ''} ahead of {baseShort}
                        {' · '}
                        <span className="text-[#16825d]">+{rangeInfo.additions}</span>
                        {' '}
                        <span className="text-[#d32f2f]">−{rangeInfo.deletions}</span>
                        {' · '}
                        {rangeInfo.fileCount} file{rangeInfo.fileCount !== 1 ? 's' : ''}
                    </div>
                </div>
                <span className="text-[10px] text-[#848484] flex-shrink-0">
                    {expanded ? '▼' : '▶'}
                </span>
            </button>

            {expanded && (
                <div className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="branch-changes-files">
                    {filesLoading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="branch-changes-files-loading">
                            <Spinner size="sm" /> Loading files...
                        </div>
                    ) : filesError ? (
                        <div className="text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="branch-changes-files-error">
                            {filesError}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {files.map((file, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                                    <span
                                        className={`font-mono font-bold w-4 text-center ${STATUS_COLORS[file.status] || 'text-[#848484]'}`}
                                        title={STATUS_LABELS[file.status] || file.status}
                                    >
                                        {STATUS_CHARS[file.status] || '?'}
                                    </span>
                                    <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] break-all flex-1">
                                        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                                    </span>
                                    <span className="text-[#16825d] text-xs flex-shrink-0">+{file.additions}</span>
                                    <span className="text-[#d32f2f] text-xs flex-shrink-0">−{file.deletions}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
