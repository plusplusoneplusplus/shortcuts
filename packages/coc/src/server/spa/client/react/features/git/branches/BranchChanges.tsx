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

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../../hooks/useApi';
import { Spinner } from '../../../shared';
import { useFileCommentCounts } from '../hooks/useFileCommentCounts';
import { computeDiffCommentKey } from '../../../../diff-comment-utils';
import { buildFileTree, compactFolders, FileTreeView, FlatFileList } from '../diff/FileTree';
import type { FileChange } from '../diff/FileTree';
import { useFilesViewMode } from '../hooks/useFilesViewMode';
import { UnifiedDiffViewer } from '../diff/UnifiedDiffViewer';

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
    /** Called when the user clicks the branch-changes section header, to show the branch range overview. */
    onBranchRangeSelect?: () => void;
}

interface BranchRangeFile extends FileChange {}

export function BranchChanges({ workspaceId, branchRangeData, initialFiles, onDefaultBranch, onFileSelect, selectedFile, onBranchContextMenu, onBranchRangeSelect }: BranchChangesProps) {
    const rangeInfo = branchRangeData ?? null;
    const [files, setFiles] = useState<BranchRangeFile[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [expandedFile, setExpandedFile] = useState<string | null>(null);
    const [fileDiff, setFileDiff] = useState<string | null>(null);
    const [fileDiffLoading, setFileDiffLoading] = useState(false);
    const [fileDiffError, setFileDiffError] = useState<string | null>(null);
    const { mode: viewMode, setMode: setViewMode } = useFilesViewMode(workspaceId);

    // Fetch active comment counts for all files in this branch range
    const commentCounts = useFileCommentCounts(workspaceId, 'branch-base', 'branch-head');
    const [fileCommentMap, setFileCommentMap] = useState<Map<string, number>>(new Map());

    // Pre-compute storageKey → count lookup keyed by filePath for render-time access
    useEffect(() => {
        if (commentCounts.size === 0 || files.length === 0) {
            setFileCommentMap(new Map());
            return;
        }
        let cancelled = false;
        const computeMap = async () => {
            const map = new Map<string, number>();
            for (const file of files) {
                const key = await computeDiffCommentKey(workspaceId, 'branch-base', 'branch-head', file.path);
                const count = commentCounts.get(key) ?? 0;
                if (count > 0) map.set(file.path, count);
            }
            if (!cancelled) setFileCommentMap(map);
        };
        void computeMap();
        return () => { cancelled = true; };
    }, [files, commentCounts, workspaceId]);

    // Reset file-level state when workspace or range data changes
    useEffect(() => {
        setFiles([]);
        setExpanded(false);
        setFilesError(null);
        setExpandedFile(null);
        setFileDiff(null);
        setFileDiffError(null);
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
            return;
        }
        setExpandedFile(filePath);
        setFileDiff(null);
        setFileDiffError(null);
        setFileDiffLoading(true);

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

        return (
            <UnifiedDiffViewer
                diff={fileDiff}
                fileName={expandedFile ?? undefined}
                showLineNumbers
                data-testid="branch-file-diff-content"
            />
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
                onClick={() => { setExpanded(prev => !prev); onBranchRangeSelect?.(); }}
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
                        <>
                            {viewMode === 'tree' ? (
                                <FileTreeView
                                    nodes={compactFolders(buildFileTree(files))}
                                    onFileSelectSimple={handleFileClick}
                                    selectedFilePath={selectedFile}
                                    fileCommentMap={fileCommentMap}
                                    commentBadgeTestIdPrefix="branch-file-comment-badge"
                                    fileTestIdPrefix="branch-file-row"
                                    renderFileExtra={(node) => (
                                        <>
                                            {!onFileSelect && expandedFile === node.path && (
                                                <div className="pl-6 pr-2 py-2" data-testid={`branch-file-diff-${node.path}`}>
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
                                        </>
                                    )}
                                />
                            ) : (
                                <FlatFileList
                                    files={files}
                                    onFileSelect={handleFileClick}
                                    selectedFilePath={selectedFile}
                                    fileCommentMap={fileCommentMap}
                                    commentBadgeTestIdPrefix="branch-file-comment-badge"
                                    fileTestIdPrefix="branch-file-row"
                                    renderFileExtra={(file) => (
                                        <>
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
                                        </>
                                    )}
                                />
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
