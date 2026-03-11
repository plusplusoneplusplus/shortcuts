/**
 * BranchChanges — collapsible section showing branch-range analysis data.
 *
 * Surfaces commit count, additions/deletions, and changed files for the
 * current feature branch vs the default branch. Hidden when on the default
 * branch or when no range data is provided.
 *
 * Branch-range data is lifted to the parent (RepoGitTab) so it can be
 * shared with GitPanelHeader. This component receives the data as a prop.
 */

import { useState, useEffect } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner, TruncatedPath } from '../shared';

export interface BranchRangeInfo {
    baseRef: string;
    headRef: string;
    commitCount: number;
    additions: number;
    deletions: number;
    mergeBase: string;
    branchName?: string;
    fileCount: number;
}

interface BranchChangesProps {
    workspaceId: string;
    branchRangeData?: BranchRangeInfo | null;
    /** Pre-fetched file list from the parent's /git/branch-range response. When provided, the component skips its own /git/branch-range/files request. */
    initialFiles?: BranchRangeFile[];
    onDefaultBranch?: boolean;
    onFileSelect?: (filePath: string) => void;
    selectedFile?: string | null;
    onBranchContextMenu?: (e: React.MouseEvent) => void;
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

const DIFF_LINE_LIMIT = 500;

export function BranchChanges({ workspaceId, branchRangeData, initialFiles, onDefaultBranch, onFileSelect, selectedFile, onBranchContextMenu }: BranchChangesProps) {
    const rangeInfo = branchRangeData ?? null;
    const [files, setFiles] = useState<BranchRangeFile[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [expandedFile, setExpandedFile] = useState<string | null>(null);
    const [fileDiff, setFileDiff] = useState<string | null>(null);
    const [fileDiffLoading, setFileDiffLoading] = useState(false);
    const [fileDiffError, setFileDiffError] = useState<string | null>(null);
    const [showFullDiff, setShowFullDiff] = useState(false);

    // Reset file-level state when workspace or range data changes
    useEffect(() => {
        setFiles([]);
        setExpanded(false);
        setFilesError(null);
        setExpandedFile(null);
        setFileDiff(null);
        setFileDiffError(null);
        setShowFullDiff(false);
    }, [workspaceId, branchRangeData]);

    useEffect(() => {
        if (!expanded || files.length > 0 || !rangeInfo) return;

        // Use pre-fetched files from parent if available — avoids a second
        // HTTP request that can produce a 404 for workspace IDs with slashes.
        if (initialFiles && initialFiles.length > 0) {
            setFiles(initialFiles);
            return;
        }

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
    }, [expanded, files.length, rangeInfo, workspaceId, initialFiles]);

    const toggleFileDiff = (filePath: string) => {
        if (expandedFile === filePath) {
            setExpandedFile(null);
            setFileDiff(null);
            setFileDiffError(null);
            setShowFullDiff(false);
            return;
        }
        setExpandedFile(filePath);
        setFileDiff(null);
        setFileDiffError(null);
        setFileDiffLoading(true);
        setShowFullDiff(false);

        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files/${encodeURIComponent(filePath)}/diff`
        )
            .then(data => setFileDiff(data.diff ?? ''))
            .catch(err => setFileDiffError(err.message || 'Failed to load diff'))
            .finally(() => setFileDiffLoading(false));
    };

    const renderDiffContent = () => {
        if (fileDiff === null) return null;
        if (fileDiff === '') {
            return <div className="text-xs text-[#848484] italic" data-testid="branch-file-diff-empty">(empty diff)</div>;
        }

        const lines = fileDiff.split('\n');
        const isTruncated = lines.length > DIFF_LINE_LIMIT && !showFullDiff;
        const displayLines = isTruncated ? lines.slice(0, DIFF_LINE_LIMIT) : lines;

        return (
            <>
                <pre
                    className="p-3 text-xs font-mono bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre"
                    data-testid="branch-file-diff-content"
                >
                    {displayLines.join('\n')}
                </pre>
                {isTruncated && (
                    <button
                        className="mt-1 text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                        onClick={(e) => { e.stopPropagation(); setShowFullDiff(true); }}
                        data-testid="branch-file-diff-show-all"
                    >
                        Diff too large — showing first {DIFF_LINE_LIMIT} lines. Show All
                    </button>
                )}
            </>
        );
    };

    const handleFileClick = (filePath: string) => {
        if (onFileSelect) {
            onFileSelect(filePath);
        } else {
            toggleFileDiff(filePath);
        }
    };

    if (onDefaultBranch || !rangeInfo) return null;

    const baseShort = rangeInfo.baseRef.replace(/^origin\//, '');
    const branchLabel = rangeInfo.branchName || rangeInfo.headRef;

    return (
        <div className="branch-changes" data-testid="branch-changes">
            <button
                className="w-full flex items-center gap-2 px-4 py-2 bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c] text-left cursor-pointer hover:bg-[#ececec] dark:hover:bg-[#2a2d2e] transition-colors"
                onClick={() => setExpanded(prev => !prev)}
                onContextMenu={(e) => { if (e.shiftKey) return; e.preventDefault(); e.stopPropagation(); onBranchContextMenu?.(e); }}
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
                                <div key={i}>
                                    <button
                                        className={`w-full flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e] transition-colors text-left ${
                                            selectedFile === file.path ? 'bg-[#e8e8e8] dark:bg-[#37373d] ring-1 ring-[#0078d4] dark:ring-[#3794ff]' : ''
                                        }`}
                                        onClick={() => handleFileClick(file.path)}
                                        data-testid={`branch-file-row-${file.path}`}
                                    >
                                        {!onFileSelect && (
                                            <span className="text-[10px] text-[#848484]">
                                                {expandedFile === file.path ? '▼' : '▶'}
                                            </span>
                                        )}
                                        <span
                                            className={`font-mono font-bold w-4 text-center ${STATUS_COLORS[file.status] || 'text-[#848484]'}`}
                                            title={STATUS_LABELS[file.status] || file.status}
                                        >
                                            {STATUS_CHARS[file.status] || '?'}
                                        </span>
                                        {file.oldPath ? (
                                            <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] flex-1 min-w-0 truncate" title={`${file.oldPath} → ${file.path}`}>
                                                {file.oldPath} → {file.path}
                                            </span>
                                        ) : (
                                            <TruncatedPath path={file.path} className="text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                                        )}
                                        <span className="text-[#16825d] text-xs flex-shrink-0">+{file.additions}</span>
                                        <span className="text-[#d32f2f] text-xs flex-shrink-0">−{file.deletions}</span>
                                    </button>

                                    {!onFileSelect && expandedFile === file.path && (
                                        <div className="pl-6 pr-2 py-2" data-testid={`branch-file-diff-${file.path}`}>
                                            {fileDiffLoading ? (
                                                <div className="flex items-center gap-2 text-xs text-[#848484]">
                                                    <Spinner size="sm" /> Loading diff...
                                                </div>
                                            ) : fileDiffError ? (
                                                <div className="text-xs text-[#d32f2f] dark:text-[#f48771]">
                                                    Failed to load diff
                                                </div>
                                            ) : (
                                                renderDiffContent()
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
