/**
 * Tests for Queue tab chat-type task filtering.
 *
 * Verifies that RepoQueueTab excludes tasks with `type === 'chat'` from
 * running, queued, and history lists — both in HTTP fetch and WebSocket paths.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'
);

describe('RepoQueueTab chat-type task filtering', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_QUEUE_TAB_PATH, 'utf-8');
    });

    describe('isNonChat filter predicate', () => {
        it('defines isNonChat at module scope', () => {
            expect(source).toContain('const isNonChat');
        });

        it('filters by type !== chat', () => {
            expect(source).toMatch(/isNonChat.*=.*t\.type\s*!==\s*'chat'/);
        });

        it('accepts objects with optional type field', () => {
            expect(source).toContain('type?: string');
        });
    });

    describe('HTTP fetch filters chat tasks', () => {
        it('filters running tasks from HTTP response', () => {
            const fetchIdx = source.indexOf('const fetchQueue');
            const fetchBlock = source.slice(fetchIdx, source.indexOf('setLoading(false)', fetchIdx) + 50);
            expect(fetchBlock).toContain("(data?.running || []).filter(isNonChat)");
        });

        it('filters queued tasks from HTTP response', () => {
            const fetchIdx = source.indexOf('const fetchQueue');
            const fetchBlock = source.slice(fetchIdx, source.indexOf('setLoading(false)', fetchIdx) + 50);
            expect(fetchBlock).toContain("(data?.queued || []).filter(isNonChat)");
        });

        it('filters history tasks from HTTP response', () => {
            const fetchIdx = source.indexOf('const fetchQueue');
            const fetchBlock = source.slice(fetchIdx, source.indexOf('setLoading(false)', fetchIdx) + 50);
            expect(fetchBlock).toContain("(historyData?.history || []).filter(isNonChat)");
        });
    });

    describe('WebSocket updates filter chat tasks', () => {
        it('filters running tasks from repoQueue WS updates', () => {
            const wsIdx = source.indexOf('Apply per-repo WS updates');
            const wsBlock = source.slice(wsIdx, wsIdx + 400);
            expect(wsBlock).toContain('repoQueue.running.filter(isNonChat)');
        });

        it('filters queued tasks from repoQueue WS updates', () => {
            const wsIdx = source.indexOf('Apply per-repo WS updates');
            const wsBlock = source.slice(wsIdx, wsIdx + 400);
            expect(wsBlock).toContain('repoQueue.queued.filter(isNonChat)');
        });

        it('filters history tasks from repoQueue WS updates', () => {
            const wsIdx = source.indexOf('Apply per-repo WS updates');
            const wsBlock = source.slice(wsIdx, wsIdx + 400);
            expect(wsBlock).toContain('repoQueue.history.filter(isNonChat)');
        });
    });

    describe('empty state reflects filtered data', () => {
        it('empty state check uses running/queued/history state (already filtered)', () => {
            // The empty state check uses the state variables which have been
            // set with filtered data — no chat tasks will be in them.
            expect(source).toContain('running.length === 0 && queued.length === 0 && history.length === 0');
        });

        it('shows "No tasks in queue" placeholder when lists are empty', () => {
            expect(source).toContain('No tasks in queue');
        });
    });

    describe('QueueContext stores unfiltered data', () => {
        it('dispatches REPO_QUEUE_UPDATED with already-filtered nextQueued/nextRunning/nextHistory', () => {
            // The dispatch sends filtered data to repoQueueMap so other consumers
            // see the same filtered view from Queue tab's HTTP fetch.
            // The QueueContext reducer itself is NOT modified — it stores whatever it receives.
            const dispatchIdx = source.indexOf("type: 'REPO_QUEUE_UPDATED'");
            const dispatchBlock = source.slice(dispatchIdx, dispatchIdx + 400);
            expect(dispatchBlock).toContain('queued: nextQueued');
            expect(dispatchBlock).toContain('running: nextRunning');
            expect(dispatchBlock).toContain('history: nextHistory');
        });
    });

    describe('chat type not in TASK_TYPE_LABELS', () => {
        it('does not include chat as a primary filter option', () => {
            const labelsIdx = source.indexOf('TASK_TYPE_LABELS');
            const labelsBlock = source.slice(labelsIdx, source.indexOf('};', labelsIdx) + 2);
            expect(labelsBlock).not.toContain("'chat'");
        });
    });

    describe('filter applies consistently to both data paths', () => {
        it('uses isNonChat in exactly two locations (HTTP fetch and WS effect)', () => {
            const matches = source.match(/\.filter\(isNonChat\)/g);
            // 3 in HTTP fetch (running, queued, history) + 3 in WS effect = 6 total
            expect(matches).toHaveLength(6);
        });
    });
});
