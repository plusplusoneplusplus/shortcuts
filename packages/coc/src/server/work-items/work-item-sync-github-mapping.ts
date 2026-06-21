import {
    isKnownWorkItemStatus,
    type KnownWorkItemStatus,
    type WorkItemStatus,
} from './types';

/** The two states a GitHub issue can be in. */
export type GitHubIssueState = 'open' | 'closed';

/**
 * CoC work-item status → GitHub issue state. GitHub issues only have two states,
 * so every non-terminal CoC lifecycle status maps to `open` and the terminal
 * states (`done`, `failed`) map to `closed`.
 */
export const COC_STATUS_TO_GITHUB_STATE: Record<KnownWorkItemStatus, GitHubIssueState> = {
    created: 'open',
    drafting: 'open',
    planning: 'open',
    readyToExecute: 'open',
    executing: 'open',
    aiDone: 'open',
    aiFailed: 'open',
    done: 'closed',
    failed: 'closed',
};

/**
 * GitHub issue state → CoC work-item status. A `closed` issue maps to `done`;
 * an `open` issue maps to `created`. Used as the fallback when an issue body
 * carries no explicit CoC status metadata.
 */
export const GITHUB_STATE_TO_COC_STATUS: Record<GitHubIssueState, WorkItemStatus> = {
    open: 'created',
    closed: 'done',
};

/** Map a CoC work-item status to a GitHub issue state. Unknown statuses stay `open`. */
export function mapWorkItemStatusToGitHubState(status: WorkItemStatus | undefined): GitHubIssueState {
    if (status && isKnownWorkItemStatus(status)) return COC_STATUS_TO_GITHUB_STATE[status];
    return 'open';
}

/** Map a GitHub issue state to a CoC work-item status. Anything other than `closed` is treated as `open`. */
export function mapGitHubStateToWorkItemStatus(state: string | undefined | null): WorkItemStatus {
    return GITHUB_STATE_TO_COC_STATUS[state === 'closed' ? 'closed' : 'open'];
}
