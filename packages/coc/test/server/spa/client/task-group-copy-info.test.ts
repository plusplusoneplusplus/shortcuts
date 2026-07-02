import { describe, expect, it } from 'vitest';
import {
    buildForEachRunCopyInfo,
    buildMapReduceRunCopyInfo,
    buildRalphSessionCopyInfo,
} from '../../../../src/server/spa/client/react/features/chat/task-group-copy-info';
import type { ForEachRunGroup } from '../../../../src/server/spa/client/react/features/chat/for-each-run-grouping';
import type { MapReduceRunGroup } from '../../../../src/server/spa/client/react/features/chat/map-reduce-run-grouping';
import type { RalphSession } from '../../../../src/server/spa/client/react/features/chat/ralph-session-grouping';

describe('task-group-copy-info', () => {
    it('builds For Each run info with the freshest available timestamp', () => {
        const group = {
            kind: 'for-each-run',
            runId: 'run-1',
            run: {
                runId: 'run-1',
                status: 'running',
                itemCount: 3,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-02T00:00:00.000Z',
            },
            children: [],
            latestTimestamp: 0,
            hasUnseen: false,
        } as unknown as ForEachRunGroup;

        expect(buildForEachRunCopyInfo(group, ['p-1', 'p-2'])).toBe([
            'For Each run run-1',
            'Status: running',
            'Items: 3',
            'Updated: 2026-01-02T00:00:00.000Z',
            'Processes:',
            '  - p-1',
            '  - p-2',
        ].join('\n'));
    });

    it('falls back through completedAt then createdAt for For Each runs', () => {
        const group = {
            runId: 'run-2',
            run: { status: 'completed', itemCount: 1, createdAt: 'created', completedAt: 'completed' },
        } as unknown as ForEachRunGroup;
        expect(buildForEachRunCopyInfo(group, [])).toContain('Updated: completed');

        const draftGroup = {
            runId: 'run-3',
            run: { status: 'draft', itemCount: 1, createdAt: 'created' },
        } as unknown as ForEachRunGroup;
        expect(buildForEachRunCopyInfo(draftGroup, [])).toContain('Updated: created');
    });

    it('builds Map Reduce run info including the reduce status', () => {
        const group = {
            kind: 'map-reduce-run',
            runId: 'run-1',
            run: {
                runId: 'run-1',
                status: 'reducing',
                reduceStatus: 'running',
                itemCount: 2,
                createdAt: '2026-01-01T00:00:00.000Z',
            },
            children: [],
        } as unknown as MapReduceRunGroup;

        expect(buildMapReduceRunCopyInfo(group, ['p-1'])).toBe([
            'Map Reduce run run-1',
            'Status: reducing',
            'Map items: 2',
            'Reduce: running',
            'Updated: 2026-01-01T00:00:00.000Z',
            'Processes:',
            '  - p-1',
        ].join('\n'));
    });

    it('builds Ralph session info with an ISO timestamp or unknown', () => {
        const session = {
            kind: 'ralph-session',
            sessionId: 's-1',
            phase: 'executing',
            iterations: [{}, {}],
            latestTimestamp: Date.UTC(2026, 0, 3),
        } as unknown as RalphSession;

        expect(buildRalphSessionCopyInfo(session, ['p-1'])).toBe([
            'Ralph session s-1',
            'Phase: executing',
            'Iterations: 2',
            'Updated: 2026-01-03T00:00:00.000Z',
            'Processes:',
            '  - p-1',
        ].join('\n'));

        const stale = { ...session, latestTimestamp: 0 } as unknown as RalphSession;
        expect(buildRalphSessionCopyInfo(stale, [])).toContain('Updated: unknown');
    });
});
