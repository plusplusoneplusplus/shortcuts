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

export {
    parseFullDiff,
    splitDiffByFile,
    makeDiffContent,
    computeSummary,
    truncateDiffContent,
    splitIntoChunks,
    extractBPath,
    extractAPath,
    inferStatusFromDiffChunk,
    countAdditionsDeletions,
} from './diff-utils';
