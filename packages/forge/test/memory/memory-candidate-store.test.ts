/**
 * Memory Candidate Store Tests
 *
 * Validates dedupe, provenance, status transitions, stats, and migration from
 * legacy pending raw memory records.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { MemoryCandidateStore } from '../../src/memory/memory-candidate-store';
import { RawMemoryRecordStore } from '../../src/memory/raw-memory-record-store';
import type { MemoryCandidateInput } from '../../src/memory/memory-candidate-types';

describe('MemoryCandidateStore', () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-candidates-'));
        dbPath = path.join(tmpDir, 'candidates.db');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    function createStore(customDbPath?: string): MemoryCandidateStore {
        return new MemoryCandidateStore({ dbPath: customDbPath ?? dbPath });
    }

    function makeInput(overrides?: Partial<MemoryCandidateInput>): MemoryCandidateInput {
        return {
            target: 'repo',
            content: 'User prefers dark mode',
            source: 'coc-chat',
            workspaceId: 'ws-test',
            processId: 'proc-1',
            turnIndex: 2,
            score: 0.8,
            seenAt: '2026-05-01T12:00:00.000Z',
            ...overrides,
        };
    }

    it('upserts duplicate normalized content into one strengthened candidate', async () => {
        const store = createStore();
        try {
            const first = await store.upsertCandidate(makeInput({
                content: '  User prefers dark mode  ',
                conceptTags: ['preference'],
            }));
            const second = await store.upsertCandidate(makeInput({
                content: 'User   prefers dark mode',
                processId: 'proc-2',
                score: 0.4,
                conceptTags: ['ui', 'preference'],
                seenAt: '2026-05-02T09:00:00.000Z',
            }));

            expect(second.id).toBe(first.id);
            expect(second.content).toBe('User prefers dark mode');
            expect(second.signalCount).toBe(2);
            expect(second.totalScore).toBeCloseTo(1.2);
            expect(second.maxScore).toBe(0.8);
            expect(second.uniqueProcessCount).toBe(2);
            expect(second.recallDays).toEqual(['2026-05-01', '2026-05-02']);
            expect(second.conceptTags).toEqual(['preference', 'ui']);

            const stats = await store.getStats();
            expect(stats).toMatchObject({ pending: 1, total: 1 });
        } finally {
            store.close();
        }
    });

    it('creates separate candidates for different content', async () => {
        const store = createStore();
        try {
            const first = await store.upsertCandidate(makeInput({ content: 'Fact A' }));
            const second = await store.upsertCandidate(makeInput({ content: 'Fact B' }));

            expect(first.id).not.toBe(second.id);
            const pending = await store.listPendingCandidates();
            expect(pending.map(c => c.content).sort()).toEqual(['Fact A', 'Fact B']);
        } finally {
            store.close();
        }
    });

    it('records candidate provenance fields', async () => {
        const store = createStore();
        try {
            const candidate = await store.upsertCandidate(makeInput({
                workspaceId: 'ws-provenance',
                processId: 'proc-abc',
                turnIndex: 7,
                source: 'background-review',
            }));

            expect(candidate.workspaceId).toBe('ws-provenance');
            expect(candidate.processId).toBe('proc-abc');
            expect(candidate.turnIndex).toBe(7);
            expect(candidate.source).toBe('background-review');
            expect(candidate.status).toBe('pending');
        } finally {
            store.close();
        }
    });

    it('only transitions pending candidates to terminal statuses', async () => {
        const store = createStore();
        try {
            const promoted = await store.upsertCandidate(makeInput({ content: 'Promote me' }));
            const dropped = await store.upsertCandidate(makeInput({ content: 'Drop me' }));
            const ignored = await store.upsertCandidate(makeInput({ content: 'Ignore me' }));

            expect(await store.markPromoted([promoted.id], '2026-05-03T00:00:00.000Z')).toBe(1);
            expect(await store.markDropped([dropped.id], 'policy', '2026-05-03T00:00:00.000Z')).toBe(1);
            expect(await store.markIgnored([ignored.id], 'not durable')).toBe(1);
            expect(await store.markDropped([promoted.id], 'late rejection')).toBe(0);

            expect((await store.getCandidate(promoted.id))?.status).toBe('promoted');
            expect((await store.getCandidate(dropped.id))?.droppedReason).toBe('policy');
            expect((await store.getCandidate(ignored.id))?.status).toBe('ignored');
        } finally {
            store.close();
        }
    });

    it('enforces known statuses at the database layer', async () => {
        const store = createStore();
        try {
            const candidate = await store.upsertCandidate(makeInput());
            const db = new Database(dbPath);
            try {
                expect(() => db
                    .prepare(`UPDATE memory_candidates SET status = 'claimed' WHERE id = ?`)
                    .run(candidate.id)).toThrow();
            } finally {
                db.close();
            }
        } finally {
            store.close();
        }
    });

    it('reports pending/promoted/dropped/ignored counts', async () => {
        const store = createStore();
        try {
            const pending = await store.upsertCandidate(makeInput({ content: 'Pending' }));
            const promoted = await store.upsertCandidate(makeInput({ content: 'Promoted' }));
            const dropped = await store.upsertCandidate(makeInput({ content: 'Dropped' }));
            const ignored = await store.upsertCandidate(makeInput({ content: 'Ignored' }));

            await store.markPromoted([promoted.id]);
            await store.markDropped([dropped.id], 'duplicate');
            await store.markIgnored([ignored.id], 'low value');

            expect(pending.status).toBe('pending');
            expect(await store.getStats()).toEqual({
                pending: 1,
                promoted: 1,
                dropped: 1,
                ignored: 1,
                total: 4,
            });
        } finally {
            store.close();
        }
    });

    it('migrates pending legacy raw records once', async () => {
        const rawStore = new RawMemoryRecordStore({ dbPath });
        await rawStore.append({
            target: 'repo',
            content: 'Legacy raw fact',
            source: 'coc-chat',
            workspaceId: 'ws-test',
            processId: 'proc-legacy',
            turnIndex: 4,
        });
        rawStore.close();

        const store = createStore();
        try {
            const pending = await store.listPendingCandidates();
            expect(pending).toHaveLength(1);
            expect(pending[0]).toMatchObject({
                content: 'Legacy raw fact',
                workspaceId: 'ws-test',
                processId: 'proc-legacy',
                turnIndex: 4,
                signalCount: 1,
            });
        } finally {
            store.close();
        }

        const reopened = createStore();
        try {
            const pending = await reopened.listPendingCandidates();
            expect(pending).toHaveLength(1);
            expect(pending[0].signalCount).toBe(1);
        } finally {
            reopened.close();
        }
    });
});
