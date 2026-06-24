/**
 * Git module — pure Node.js git types, constants, and helpers.
 */

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
    GitRangeConfig,
    BranchStatus,
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
    execGit,
    execGitAsync,
} from './exec';

export { GitLogService } from './git-log-service';
export { GitRangeService } from './git-range-service';
export { BranchService } from './branch-service';
export { WorkingTreeService, parsePorcelain } from './working-tree-service';
export { normalizeRemoteUrl } from './normalize-url';
export {
    getRemoteUrl,
    computeRemoteHash,
    detectRemoteUrl,
    resolveCanonicalOrigin,
    resolveCanonicalOriginId,
    type CanonicalOriginInput,
    type CanonicalOriginIdentity,
    type CanonicalOriginProvider,
} from './remote';
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
