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
} from './types';

export {
    STATUS_SHORT,
    STAGE_PREFIX,
    STAGE_LABEL,
} from './constants';

export {
    ExecGitOptions,
    execGit,
} from './exec';

export { GitLogService } from './git-log-service';
export { GitRangeService } from './git-range-service';
export { BranchService } from './branch-service';
export { WorkingTreeService, parsePorcelain } from './working-tree-service';
export { normalizeRemoteUrl } from './normalize-url';
export { getRemoteUrl, computeRemoteHash, detectRemoteUrl } from './remote';
