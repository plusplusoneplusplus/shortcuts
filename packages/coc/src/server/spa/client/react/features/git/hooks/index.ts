export { useFileDiff } from './useFileDiff';
export { useCachedDiff, clearCacheForHash } from './useCommitDiffCache';
export { getCommitsCache, setCommitsCache, clearCommitsCache } from './useCommitsCache';
export { getBranchRangeCache, setBranchRangeCache, clearBranchRangeCache } from './useBranchRangeCache';
export { useCrossFileNav } from './useCrossFileNav';
export { useSyntaxHighlight, getLanguageFromFileName, highlightLine, highlightBlock } from './useSyntaxHighlight';
export { useAllCommitComments } from './useAllCommitComments';
export { useCommitCommentTotals } from './useCommitCommentTotals';
export { useDiffComments } from './useDiffComments';
export type { UpdateDiffCommentRequest } from './useDiffComments';
export { useDiffViewMode } from './useDiffViewMode';
export type { DiffViewMode } from './useDiffViewMode';
export { useFileCommentCounts } from './useFileCommentCounts';
export { useGitInfo } from './useGitInfo';
export type { GitInfo } from './useGitInfo';
export { useCommitChatBinding } from './useCommitChatBinding';
export { useFilesViewMode } from './useFilesViewMode';
export { useCommitClassificationStatus } from './useCommitClassificationStatus';
export type { UseCommitClassificationStatusReturn } from './useCommitClassificationStatus';
export { useGitOperationPoller } from './useGitOperationPoller';
export type {
    GitOperationPollerCallbacks,
    PolledGitOperation,
    UseGitOperationPollerOptions,
    UseGitOperationPollerReturn,
} from './useGitOperationPoller';
