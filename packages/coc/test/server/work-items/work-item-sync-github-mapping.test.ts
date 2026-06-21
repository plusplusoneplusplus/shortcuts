import { describe, expect, it } from 'vitest';
import {
    COC_STATUS_TO_GITHUB_STATE,
    GITHUB_STATE_TO_COC_STATUS,
    mapGitHubStateToWorkItemStatus,
    mapWorkItemStatusToGitHubState,
    type GitHubIssueState,
} from '../../../src/server/work-items/work-item-sync-github-mapping';
import {
    WORK_ITEM_STATUSES,
    isTerminalStatus,
    type KnownWorkItemStatus,
} from '../../../src/server/work-items/types';

describe('GitHub work item state mapping', () => {
    it('maps every known CoC status to a GitHub state and matches the terminal-status rule', () => {
        const cases: Array<[KnownWorkItemStatus, GitHubIssueState]> = [
            ['created', 'open'],
            ['drafting', 'open'],
            ['planning', 'open'],
            ['readyToExecute', 'open'],
            ['executing', 'open'],
            ['aiDone', 'open'],
            ['aiFailed', 'open'],
            ['done', 'closed'],
            ['failed', 'closed'],
        ];

        for (const [status, expected] of cases) {
            expect(mapWorkItemStatusToGitHubState(status)).toBe(expected);
            expect(COC_STATUS_TO_GITHUB_STATE[status]).toBe(expected);
        }
    });

    it('covers every known status in the forward table (exhaustive)', () => {
        for (const status of WORK_ITEM_STATUSES) {
            expect(COC_STATUS_TO_GITHUB_STATE[status]).toBeDefined();
        }
        expect(Object.keys(COC_STATUS_TO_GITHUB_STATE).sort()).toEqual([...WORK_ITEM_STATUSES].sort());
    });

    it('preserves the legacy terminal-status behavior for the forward mapping', () => {
        // Regression: the forward map must keep agreeing with isTerminalStatus(...) ? 'closed' : 'open'.
        for (const status of WORK_ITEM_STATUSES) {
            const expected: GitHubIssueState = isTerminalStatus(status) ? 'closed' : 'open';
            expect(mapWorkItemStatusToGitHubState(status)).toBe(expected);
        }
    });

    it('treats unknown or missing statuses as open', () => {
        expect(mapWorkItemStatusToGitHubState('weird-custom-status' as never)).toBe('open');
        expect(mapWorkItemStatusToGitHubState(undefined)).toBe('open');
        expect(mapWorkItemStatusToGitHubState('' as never)).toBe('open');
    });

    it('maps GitHub states back to CoC statuses', () => {
        expect(mapGitHubStateToWorkItemStatus('open')).toBe('created');
        expect(mapGitHubStateToWorkItemStatus('closed')).toBe('done');
        expect(GITHUB_STATE_TO_COC_STATUS.open).toBe('created');
        expect(GITHUB_STATE_TO_COC_STATUS.closed).toBe('done');
    });

    it('preserves the legacy reverse behavior: only "closed" maps to done', () => {
        // Regression: anything other than 'closed' must resolve to 'created'.
        for (const state of ['open', 'unknown', '', undefined, null]) {
            const expected = state === 'closed' ? 'done' : 'created';
            expect(mapGitHubStateToWorkItemStatus(state as never)).toBe(expected);
        }
        expect(mapGitHubStateToWorkItemStatus('closed')).toBe('done');
    });
});
