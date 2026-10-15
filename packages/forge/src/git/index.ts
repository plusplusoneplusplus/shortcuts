export {
    GitChangeStatus,
    GitChangeStage,
    GitChange,
    GitChangeCounts,
    GitCommit,
    CommitLoadOptions,
    CommitLoadResult,
    GitCommitFile,
    GitCommentCounts,
    GitCommitRange,
    GitCommitRangeFile,
    GitRangeBaseMode,
    GitRangeConfig,
    BranchStatus,
    GitRepositoryStatus,
    GitBranch,
    BranchListOptions,
    PaginatedBranchResult,
    GitOperationResult,
    GitCherryPickOptions,
    GitCherryPickResult,
    GitPatchExportPayload,
    GitPatchExportResult,
    GitPatchMultiExportPayload,
    GitPatchMultiExportResult,
    GitPatchApplyOptions,
    GitPatchApplyResult,
    RepoOperationType,
    GitOperationInProgress,
    RepoState,
} from './types';

export {
    STATUS_SHORT,
    STAGE_PREFIX,
    STAGE_LABEL,
} from './constants';

export {
    ExecGitOptions,
    execGitAsync,
    readGitBlob,
    GitBlobTooLargeError,
    ReadGitBlobOptions,
    runGitViaWslBytes,
    runGitViaWsl,
} from './exec';

export { GitLogService } from './git-log-service';
export { loadGitHistory } from './git-history';
export { GitRangeService } from './git-range-service';
export { BranchService, parsePorcelainV2BranchStatus } from './branch-service';
export { WorkingTreeService } from './working-tree-service';
export { normalizeRemoteUrl } from './normalize-url';
export {
    resolveRepoIdentity,
    isSameRepoClone,
    isSameNormalizedOrigin,
    type RepoIdentity,
    type RepoIdentityInput,
} from './repo-identity';
export {
    getRemoteUrl,
    computeRemoteHash,
    detectRemoteUrl,
} from './remote';
export {
    resolveCanonicalOrigin,
    resolveCanonicalOriginId,
    type CanonicalOriginInput,
    type CanonicalOriginIdentity,
    type CanonicalOriginProvider,
} from './origin-id';
export { sha256Hex } from './sha256';
export {
    GitOpsStore,
    GitOpJob,
    GitOpType,
    GitOpStatus,
    GitOpWorkspaceMetadata,
    GitOpServerMetadata,
    GitOpCommitAuthorMetadata,
    GitOpCommitMetadata,
    GitPatchTransferOperationMetadata,
    GitOpMetadata,
    GitOpsStoreOptions,
} from './git-ops-store';

export { createPullRequestGit, pullRequestGit, type PullRequestGit, type PullRequestGitRunner } from './pull-request-git';
export { discoverGitRepoRoot } from './discover-repo-root';
