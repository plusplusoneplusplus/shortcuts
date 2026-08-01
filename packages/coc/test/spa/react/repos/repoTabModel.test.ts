/**
 * repoTabModel — unit tests for the extracted pure navigation-model helpers.
 */
import { describe, it, expect } from 'vitest';
import {
    getRepoQueueStatusInfo,
    getRepoQueueAccessibleLabel,
    getRepoDisplayName,
    flattenGroups,
    buildRepoQueueStatusMap,
    computeRepoOverflowState,
} from '../../../../src/server/spa/client/react/features/repo-detail/repoTabModel';
import type { RepoData, RepoGroup } from '../../../../src/server/spa/client/react/repos/repoGrouping';

const makeRepo = (id: string, name = id): RepoData => ({
    workspace: { id, name, rootPath: `/repos/${id}` },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
});

const group = (repos: RepoData[]): RepoGroup => ({ normalizedUrl: null, label: 'g', repos, expanded: true });

describe('getRepoQueueStatusInfo', () => {
    it('maps each status to its label and icon', () => {
        expect(getRepoQueueStatusInfo('running')).toEqual({ status: 'running', label: 'running jobs', icon: 'play' });
        expect(getRepoQueueStatusInfo('queued')).toEqual({ status: 'queued', label: 'queued jobs', icon: 'pending' });
        expect(getRepoQueueStatusInfo('paused')).toEqual({ status: 'paused', label: 'queue paused', icon: 'pause' });
        expect(getRepoQueueStatusInfo('idle')).toEqual({ status: 'idle', label: 'idle', icon: null });
    });
});

describe('getRepoQueueAccessibleLabel', () => {
    it('returns the bare name when idle', () => {
        expect(getRepoQueueAccessibleLabel('Alpha', 'idle')).toBe('Alpha');
    });
    it('appends the status label for active states', () => {
        expect(getRepoQueueAccessibleLabel('Alpha', 'running')).toBe('Alpha, running jobs');
        expect(getRepoQueueAccessibleLabel('Alpha', 'paused')).toBe('Alpha, queue paused');
    });
});

describe('getRepoDisplayName', () => {
    it('prefixes the agent name for container repos', () => {
        expect(getRepoDisplayName({ name: 'repo', agentName: 'dev2' })).toBe('dev2:repo');
    });
    it('returns the bare name without an agent', () => {
        expect(getRepoDisplayName({ name: 'repo' })).toBe('repo');
        expect(getRepoDisplayName({ name: 'repo', agentName: '' })).toBe('repo');
    });
});

describe('flattenGroups', () => {
    it('produces a flat ordered list of workspace ids across groups', () => {
        const groups = [group([makeRepo('a'), makeRepo('b')]), group([makeRepo('c')])];
        expect(flattenGroups(groups)).toEqual(['a', 'b', 'c']);
    });
    it('returns an empty list for no groups', () => {
        expect(flattenGroups([])).toEqual([]);
    });
});

describe('buildRepoQueueStatusMap', () => {
    const repos = [makeRepo('r1'), makeRepo('r2'), makeRepo('r3'), makeRepo('r4'), makeRepo('r5')];

    it('defaults every repo to idle when there is no queue map', () => {
        expect(buildRepoQueueStatusMap(repos, undefined)).toEqual({
            r1: 'idle', r2: 'idle', r3: 'idle', r4: 'idle', r5: 'idle',
        });
    });

    it('prioritizes paused > running > queued > idle and ignores hidden tasks', () => {
        const map = buildRepoQueueStatusMap(repos, {
            // paused wins even with running work present
            r1: { stats: { isPaused: true }, running: [{}], queued: [{}] },
            r2: { running: [{}] },
            r3: { queued: [{}] },
            r4: {},
            // hidden chat task (type chat + processId) does not count as running
            r5: { running: [{ type: 'chat', payload: { processId: 'p1' } }] },
        });
        expect(map).toEqual({ r1: 'paused', r2: 'running', r3: 'queued', r4: 'idle', r5: 'idle' });
    });
});

describe('computeRepoOverflowState', () => {
    const allRepoIds = ['r1', 'r2', 'r3'];

    it('reports no overflow when every tab fits (visible set is null)', () => {
        expect(computeRepoOverflowState(null, allRepoIds, 'r1', {})).toEqual({
            overflowCount: 0,
            hasOverflow: false,
            overflowHasUnseen: false,
            selectedIsHidden: false,
        });
    });

    it('counts hidden repos and flags unseen + selected-hidden', () => {
        const visible = new Set(['r1']);
        expect(computeRepoOverflowState(visible, allRepoIds, 'r3', { r3: 2 })).toEqual({
            overflowCount: 2,
            hasOverflow: true,
            overflowHasUnseen: true,
            selectedIsHidden: true,
        });
    });

    it('does not flag selected-hidden when the selected repo is visible', () => {
        const visible = new Set(['r1', 'r2']);
        const state = computeRepoOverflowState(visible, allRepoIds, 'r1', {});
        expect(state.hasOverflow).toBe(true);
        expect(state.selectedIsHidden).toBe(false);
        expect(state.overflowHasUnseen).toBe(false);
    });
});
