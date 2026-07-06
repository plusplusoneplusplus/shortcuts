import { describe, expect, it } from 'vitest';
import {
    isCompactingProcess,
    mergeCompactingConversations,
    type CompactionProcessLike,
} from '../../../../src/server/spa/client/react/features/chat/compacting-conversations';

function historyItem(overrides: any = {}): any {
    return {
        id: 'proc-1',
        type: 'chat',
        status: 'completed',
        title: 'Completed conversation',
        workspaceId: 'ws-1',
        startTime: 1000,
        ...overrides,
    };
}

function runningTask(overrides: any = {}): any {
    return {
        id: 'queue_task-1',
        processId: 'proc-running',
        type: 'chat',
        status: 'running',
        ...overrides,
    };
}

function proc(overrides: Partial<CompactionProcessLike> = {}): CompactionProcessLike {
    return {
        id: 'proc-1',
        status: 'completed',
        type: 'chat',
        ...overrides,
    };
}

const compactingMeta = { compaction: { state: 'running' as const } };

describe('isCompactingProcess', () => {
    it('is true only when status is running AND compaction.state is running', () => {
        expect(isCompactingProcess(proc({ status: 'running', metadata: compactingMeta }))).toBe(true);
    });

    it('is false when status is running but compaction is not in-flight', () => {
        // A normally-running turn (no compaction metadata) must not be treated as compacting.
        expect(isCompactingProcess(proc({ status: 'running' }))).toBe(false);
        expect(isCompactingProcess(proc({ status: 'running', metadata: { compaction: { state: 'completed' } } }))).toBe(false);
        expect(isCompactingProcess(proc({ status: 'running', metadata: { compaction: { state: 'failed' } } }))).toBe(false);
    });

    it('is false when compaction.state is running but status is already terminal', () => {
        expect(isCompactingProcess(proc({ status: 'completed', metadata: compactingMeta }))).toBe(false);
    });

    it('is false for null/undefined', () => {
        expect(isCompactingProcess(null)).toBe(false);
        expect(isCompactingProcess(undefined)).toBe(false);
    });

    // The runtime value from `appState.processes` (seeded by `/api/processes/summaries`
    // and kept fresh by `process-updated`) carries compaction FLAT on the summary,
    // not nested under `metadata`. Lock in that this is the shape actually bucketed.
    it('is true for the flat compaction shape carried on the process summary', () => {
        expect(isCompactingProcess(proc({ status: 'running', compaction: { state: 'running' } }))).toBe(true);
    });

    it('is false for the flat shape once compaction has settled', () => {
        expect(isCompactingProcess(proc({ status: 'completed', compaction: { state: 'completed' } }))).toBe(false);
        expect(isCompactingProcess(proc({ status: 'failed', compaction: { state: 'failed' } }))).toBe(false);
    });
});

describe('mergeCompactingConversations', () => {
    it('AC-01: promotes a compacting conversation from history into running', () => {
        const history = [historyItem({ id: 'proc-1' })];
        const processes = [proc({ id: 'proc-1', status: 'running', metadata: compactingMeta })];

        const result = mergeCompactingConversations({ running: [], history, processes });

        expect(result.running.map(t => t.id)).toEqual(['proc-1']);
        expect(result.running[0].status).toBe('running');
        // Removed from history so it renders only under RUNNING (no duplicate).
        expect(result.history).toEqual([]);
    });

    it('AC-01: preserves display fields when promoting the history row', () => {
        const history = [historyItem({ id: 'proc-1', title: 'My chat', customTitle: 'Renamed' })];
        const processes = [proc({ id: 'proc-1', status: 'running', metadata: compactingMeta })];

        const { running } = mergeCompactingConversations({ running: [], history, processes });

        expect(running[0].title).toBe('My chat');
        expect(running[0].customTitle).toBe('Renamed');
        expect(running[0].type).toBe('chat');
    });

    it('AC-02: leaves history untouched once compaction settles (completed)', () => {
        const history = [historyItem({ id: 'proc-1', status: 'completed' })];
        // priorStatus restored to completed, compaction.state -> completed.
        const processes = [proc({ id: 'proc-1', status: 'completed', metadata: { compaction: { state: 'completed' } } })];

        const result = mergeCompactingConversations({ running: [], history, processes });

        expect(result.running).toEqual([]);
        expect(result.history).toBe(history); // same reference — pure no-op
    });

    it('AC-02: restores prior terminal status (failed) — does not force completed', () => {
        // A previously-failed conversation stays failed after compaction settles.
        const history = [historyItem({ id: 'proc-1', status: 'failed' })];
        const processes = [proc({ id: 'proc-1', status: 'failed', metadata: { compaction: { state: 'completed' } } })];

        const result = mergeCompactingConversations({ running: [], history, processes });

        expect(result.running).toEqual([]);
        expect(result.history[0].status).toBe('failed');
    });

    it('does not duplicate a conversation already present in the running bucket', () => {
        // If the queue already surfaces it as running, do not add a second copy.
        const running = [runningTask({ id: 'queue_x', processId: 'proc-1' })];
        const history = [historyItem({ id: 'proc-1' })];
        const processes = [proc({ id: 'proc-1', status: 'running', metadata: compactingMeta })];

        const result = mergeCompactingConversations({ running, history, processes });

        expect(result.running).toHaveLength(1);
        expect(result.running[0].id).toBe('queue_x');
        // Still removed from history so it is not shown twice.
        expect(result.history).toEqual([]);
    });

    it('reload fallback: synthesizes a running row when the conversation is absent from history', () => {
        // A reload mid-compaction: the terminal-only history endpoint excludes the
        // running process, so it is not in local history — synthesize from the index.
        const processes = [proc({
            id: 'proc-1',
            status: 'running',
            metadata: compactingMeta,
            title: 'Reloaded chat',
            workspaceId: 'ws-1',
            startTime: 2000,
        })];

        const result = mergeCompactingConversations({ running: [], history: [], processes });

        expect(result.running).toHaveLength(1);
        expect(result.running[0].id).toBe('proc-1');
        expect(result.running[0].processId).toBe('proc-1');
        expect(result.running[0].status).toBe('running');
        expect(result.running[0].type).toBe('chat');
        expect(result.running[0].displayName).toBe('Reloaded chat');
    });

    it('is a pure no-op (same references) when nothing is compacting', () => {
        const running = [runningTask()];
        const history = [historyItem({ id: 'proc-1' }), historyItem({ id: 'proc-2' })];
        const processes = [
            proc({ id: 'proc-1', status: 'completed' }),
            proc({ id: 'proc-2', status: 'failed' }),
        ];

        const result = mergeCompactingConversations({ running, history, processes });

        expect(result.running).toBe(running);
        expect(result.history).toBe(history);
    });

    it('AC-01/AC-02: buckets and settles using the flat runtime compaction shape', () => {
        // Mirrors exactly what RepoChatTab feeds: `appState.processes` entries carry
        // `compaction` FLAT (from `ProcessSummary`/`ProcessIndexEntry`), never nested.
        const history = [historyItem({ id: 'proc-1', status: 'completed' })];

        // In flight: status running + flat compaction.state running -> promoted to running.
        const inFlight = mergeCompactingConversations({
            running: [],
            history,
            processes: [proc({ id: 'proc-1', status: 'running', compaction: { state: 'running' } })],
        });
        expect(inFlight.running.map(t => t.id)).toEqual(['proc-1']);
        expect(inFlight.running[0].status).toBe('running');
        expect(inFlight.history).toEqual([]);

        // Settled: prior terminal status restored + flat compaction.state completed
        // -> back to history, out of running (pure no-op on the history reference).
        const settled = mergeCompactingConversations({
            running: [],
            history,
            processes: [proc({ id: 'proc-1', status: 'completed', compaction: { state: 'completed' } })],
        });
        expect(settled.running).toEqual([]);
        expect(settled.history).toBe(history);
    });

    it('handles multiple simultaneous compactions and mixes promote + synthesize', () => {
        const history = [historyItem({ id: 'proc-1' })]; // in history -> promoted
        const processes = [
            proc({ id: 'proc-1', status: 'running', metadata: compactingMeta }),
            proc({ id: 'proc-2', status: 'running', metadata: compactingMeta, title: 'Synth' }), // absent -> synthesized
            proc({ id: 'proc-3', status: 'completed' }), // not compacting
        ];

        const result = mergeCompactingConversations({ running: [], history, processes });

        expect(new Set(result.running.map(t => t.id))).toEqual(new Set(['proc-1', 'proc-2']));
        expect(result.history).toEqual([]);
    });
});
