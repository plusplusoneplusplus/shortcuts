export type {
    DiffSourceKind,
    DiffFileEntry,
    DiffContent,
    DiffSummary,
    DiffSource,
    CommitDiffSource,
    RangeDiffSource,
    WorkingTreeDiffSource,
    PullRequestDiffSource,
    PullRequestIterationDiffSource,
    IDiffProvider,
    GetFileDiffOptions,
} from './types';

export {
    createCommitDiffProvider,
    createRangeDiffProvider,
    createWorkingTreeDiffProvider,
} from './git-diff-provider';

export {
    createPullRequestDiffProvider,
    createPullRequestDiffProviderFromParams,
    createPullRequestIterationDiffProvider,
    createPullRequestIterationDiffProviderFromParams,
} from './pr-diff-provider';

export { parseFullDiffAsync } from './diff-utils';

export { loadComparisonPatch, loadCommitShowPatch, loadCommitFiles, loadWorkingTreePatch } from './local-patch';
