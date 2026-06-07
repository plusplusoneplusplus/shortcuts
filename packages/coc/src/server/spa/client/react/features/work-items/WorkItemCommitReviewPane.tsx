import { Spinner } from '../../ui';
import { CommitDetail } from '../git/commits/CommitDetail';
import { FileDiffPanel } from '../git/diff/FileDiffPanel';
import { buildFileTree, compactFolders, FileTreeView } from '../git/diff/FileTree';
import { createCommitDiffSource } from '../git/diff/diffSource';

export interface WorkItemCommitFile {
    status: string;
    path: string;
}

export interface WorkItemCommitReviewPaneProps {
    workspaceId: string;
    selectedCommitHash: string;
    selectedCommitFile: string | null;
    commitFiles: WorkItemCommitFile[];
    commitFilesLoading: boolean;
    commitFilePaths: string[];
    fileCommentMap: Map<string, number>;
    hunkTarget: 'first' | 'last' | undefined;
    onBackFromCommit: () => void;
    onCommitFileSelect: (filePath: string) => void;
    onNavigateToFile: (filePath: string, target: 'first' | 'last') => void;
}

export function WorkItemCommitReviewPane({
    workspaceId,
    selectedCommitHash,
    selectedCommitFile,
    commitFiles,
    commitFilesLoading,
    commitFilePaths,
    fileCommentMap,
    hunkTarget,
    onBackFromCommit,
    onCommitFileSelect,
    onNavigateToFile,
}: WorkItemCommitReviewPaneProps) {
    return (
        <div className="flex flex-col h-full overflow-hidden" data-testid="work-item-commit-review">
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#474749] flex items-center gap-2">
                <button
                    onClick={onBackFromCommit}
                    className="text-sm text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] shrink-0"
                    data-testid="commit-review-back-btn"
                    aria-label={selectedCommitFile ? 'Back to file list' : 'Back to work item'}
                >
                    ←
                </button>
                <span className="text-xs font-medium text-[#3c3c3c] dark:text-[#cccccc]">
                    {selectedCommitFile ? 'File Diff' : 'Commit Review'}
                </span>
                <code className="text-xs text-[#848484] font-mono">{selectedCommitHash.slice(0, 7)}</code>
                {selectedCommitFile && (
                    <span className="text-[11px] text-[#616161] dark:text-[#999] truncate" title={selectedCommitFile}>
                        — {selectedCommitFile.split('/').pop()}
                    </span>
                )}
            </div>
            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div
                    className="w-56 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto bg-[#f8f8f8] dark:bg-[#1e1e1e]"
                    data-testid="commit-file-sidebar"
                >
                    <div className="px-2 py-2">
                        <div className="text-[11px] font-medium text-[#616161] dark:text-[#999] mb-1.5 px-1">
                            Changed Files {!commitFilesLoading && commitFiles.length > 0 && `(${commitFiles.length})`}
                        </div>
                        {commitFilesLoading ? (
                            <div className="flex items-center gap-2 text-[11px] text-[#848484] px-1" data-testid="commit-files-loading">
                                <Spinner size="sm" /> Loading...
                            </div>
                        ) : commitFiles.length > 0 ? (
                            <FileTreeView
                                nodes={compactFolders(buildFileTree(commitFiles))}
                                commitHash={selectedCommitHash}
                                selectedFile={selectedCommitFile ? { hash: selectedCommitHash, filePath: selectedCommitFile } : null}
                                onFileSelect={(_hash, filePath) => onCommitFileSelect(filePath)}
                                fileCommentMap={fileCommentMap}
                                commentBadgeTestIdPrefix="wi-commit-file-comment-badge"
                                fileTestIdPrefix="wi-commit-file"
                            />
                        ) : (
                            <div className="text-[11px] text-[#848484] px-1">No files changed</div>
                        )}
                    </div>
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                    {selectedCommitFile ? (
                        <FileDiffPanel
                            key={`${selectedCommitHash}-${selectedCommitFile}`}
                            source={createCommitDiffSource(workspaceId, selectedCommitHash, {
                                files: commitFilePaths,
                            })}
                            workspaceId={workspaceId}
                            filePath={selectedCommitFile}
                            onNavigateToFile={onNavigateToFile}
                            initialHunkTarget={hunkTarget}
                        />
                    ) : (
                        <CommitDetail
                            key={selectedCommitHash}
                            workspaceId={workspaceId}
                            hash={selectedCommitHash}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
