/**
 * Git worktree execution module (server side).
 *
 * - `worktree-request`  — parse/validate the opt-in `worktree` launch body field.
 * - `worktree-metadata-store` — repo-scoped persistence of worktree records.
 * - `worktree-service`  — create/remove Git worktrees for isolated runs.
 */

export {
    parseWorktreeExecutionRequest,
    type ParseWorktreeRequestResult,
    type WorktreeExecutionRequest,
} from './worktree-request';

export {
    WorktreeMetadataStore,
    WORKTREES_DIR,
    WORKTREES_INDEX_FILE,
    type WorktreeMetadataStoreOptions,
    type WorktreeMetadata,
} from './worktree-metadata-store';

export {
    GitWorktreeService,
    buildWorktreeBranch,
    slugifyBranchComponent,
    type GitWorktreeServiceOptions,
    type GitRunner,
    type CreateWorktreeInput,
    type CreateWorktreeResult,
    type RemoveWorktreeResult,
} from './worktree-service';
