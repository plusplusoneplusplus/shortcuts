/**
 * CommitExpandedFiles — the inline file list rendered under an expanded commit
 * row, in either tree or flat mode, with per-file comment badges.
 */

import { buildFileTree, compactFolders, FileTreeView, FlatFileList } from '../diff/FileTree';
import type { FileChange, FilesViewMode } from '../diff/FileTree';
import type { GitCommitItem } from './commitListTypes';

export function CommitExpandedFiles({ commit, files, isFilesLoading, viewMode, selectedFile, onFileSelect, fileCommentMap, repoRoot }: {
    commit: GitCommitItem;
    files: FileChange[] | undefined;
    isFilesLoading: boolean;
    viewMode: FilesViewMode;
    selectedFile?: { hash: string; filePath: string } | null;
    onFileSelect?: (hash: string, filePath: string) => void;
    fileCommentMap: Map<string, number>;
    repoRoot?: string;
}) {
    return (
        <div className="pl-8 pr-3 py-1 bg-[#f8f8f8] dark:bg-[#1e1e1e] border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid={`commit-files-${commit.shortHash}`}>
            {isFilesLoading ? (
                <div className="text-[11px] text-[#848484] py-1" data-testid="commit-files-loading">Loading files...</div>
            ) : files && files.length > 0 ? (
                <>
                    {viewMode === 'tree' ? (
                        <FileTreeView
                            nodes={compactFolders(buildFileTree(files))}
                            commitHash={commit.hash}
                            selectedFile={selectedFile}
                            onFileSelect={onFileSelect}
                            fileCommentMap={fileCommentMap}
                            repoRoot={repoRoot}
                        />
                    ) : (
                        <FlatFileList
                            files={files}
                            onFileSelect={(filePath) => onFileSelect?.(commit.hash, filePath)}
                            selectedFilePath={selectedFile?.hash === commit.hash ? selectedFile?.filePath : null}
                            fileCommentMap={fileCommentMap}
                            commentBadgeTestIdPrefix="commit-file-comment-badge"
                            fileTestIdPrefix="commit-file"
                            repoRoot={repoRoot}
                        />
                    )}
                </>
            ) : files ? (
                <div className="text-[11px] text-[#848484] py-1">No files changed</div>
            ) : null}
        </div>
    );
}
