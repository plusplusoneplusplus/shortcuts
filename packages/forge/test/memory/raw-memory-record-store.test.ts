/**
 * Raw Memory Record Store Tests
 *
 * Validates schema initialization, append, claim/release/complete lifecycle,
 * stats, and concurrent access safety.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RawMemoryRecordStore } from '../../src/memory/raw-memory-record-store';
import type { RawMemoryRecordInput } from '../../src/memory/raw-memory-record-types';

describe('RawMemoryRecordStore', () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'raw-memory-'));
        dbPath = path.join(tmpDir, 'raw-records.db');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    function createStore(customDbPath?: string): RawMemoryRecordStore {
        return new RawMemoryRecordStore({ dbPath: customDbPath ?? dbPath });
    }

    function makeInput(overrides?: Partial<RawMemoryRecordInput>): RawMemoryRecordInput {
        return {
            target: 'repo',
            content: 'some memory fact',
            source: 'chat',
            workspaceId: 'ws-test',
            ...overrides,
        };
    }

    // -----------------------------------------------------------------------
    // 1. Schema Initialization
    // -----------------------------------------------------------------------

    describe('Schema Initialization', () => {
        it('creates the database and schema on construction', async () => {
            const store = createStore();
            try {
                const stats = await store.getStats();
                expect(stats.total).toBe(0);
                expect(stats.pending).toBe(0);
            } finally {
                store.close();
            }
        });

        it('is idempotent — opening the same DB twice does not fail', async () => {
            const store1 = createStore();
            store1.close();

            const store2 = createStore();
            try {
                const stats = await store2.getStats();
                expect(stats.total).toBe(0);
            } finally {
                store2.close();
            }
        });

        it('creates parent directories if they do not exist', async () => {
            const nested = path.join(tmpDir, 'a', 'b', 'c', 'raw-records.db');
            const store = createStore(nested);
            try {
                const record = await store.append(makeInput());
                expect(record.id).toBeTruthy();
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 2. Append
    // -----------------------------------------------------------------------

    describe('append', () => {
        it('appends a record and returns it with generated id and timestamps', async () => {
            const store = createStore();
            try {
                const record = await store.append(makeInput({
                    content: 'User prefers dark mode',
                    processId: 'proc-1',
                    turnIndex: 3,
                }));

                expect(record.id).toBeTruthy();
                expect(record.target).toBe('repo');
                expect(record.content).toBe('User prefers dark mode');
                expect(record.source).toBe('chat');
                expect(record.workspaceId).toBe('ws-test');
                expect(record.processId).toBe('proc-1');
                expect(record.turnIndex).toBe(3);
                expect(record.status).toBe('pending');
                expect(record.createdAt).toBeTruthy();
                expect(record.batchId).toBeNull();
                expect(record.claimedAt).toBeNull();
                expect(record.aggregatedAt).toBeNull();
                expect(record.droppedAt).toBeNull();
            } finally {
                store.close();
            }
        });

        it('appends multiple records with distinct ids', async () => {
            const store = createStore();
            try {
                const r1 = await store.append(makeInput({ content: 'fact 1' }));
                const r2 = await store.append(makeInput({ content: 'fact 2' }));

                expect(r1.id).not.toBe(r2.id);

                const stats = await store.getStats();
                expect(stats.total).toBe(2);
                expect(stats.pending).toBe(2);
            } finally {
                store.close();
            }
        });

        it('appends records even when bounded MEMORY.md is full (independence)', async () => {
            const store = createStore();
            try {
                // Simulate many appends — the store has no char limit
                for (let i = 0; i < 50; i++) {
                    await store.append(makeInput({ content: `fact-${i}: ${'x'.repeat(200)}` }));
                }
                const stats = await store.getStats();
                expect(stats.total).toBe(50);
                expect(stats.pending).toBe(50);
            } finally {
                store.close();
            }
        });

        it('preserves optional fields when null', async () => {
            const store = createStore();
            try {
                const record = await store.append(makeInput({
                    processId: null,
                    turnIndex: null,
                    fingerprint: null,
                    metadataJson: null,
                }));

                expect(record.processId).toBeNull();
                expect(record.turnIndex).toBeNull();
                expect(record.fingerprint).toBeNull();
                expect(record.metadataJson).toBeNull();
            } finally {
                store.close();
            }
        });

        it('stores fingerprint and metadata_json', async () => {
            const store = createStore();
            try {
                const record = await store.append(makeInput({
                    fingerprint: 'sha256:abc123',
                    metadataJson: JSON.stringify({ model: 'gpt-4' }),
                }));

                expect(record.fingerprint).toBe('sha256:abc123');
                expect(record.metadataJson).toBe('{"model":"gpt-4"}');
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 3. listPending
    // -----------------------------------------------------------------------

    describe('listPending', () => {
        it('returns empty array when no records exist', async () => {
            const store = createStore();
            try {
                const records = await store.listPending();
                expect(records).toEqual([]);
            } finally {
                store.close();
            }
        });

        it('returns pending records ordered by created_at', async () => {
            const store = createStore();
            try {
                await store.append(makeInput({ content: 'first' }));
                await store.append(makeInput({ content: 'second' }));
                await store.append(makeInput({ content: 'third' }));

                const records = await store.listPending();
                expect(records).toHaveLength(3);
                expect(records[0].content).toBe('first');
                expect(records[2].content).toBe('third');
            } finally {
                store.close();
            }
        });

        it('respects the limit parameter', async () => {
            const store = createStore();
            try {
                for (let i = 0; i < 10; i++) {
                    await store.append(makeInput({ content: `fact-${i}` }));
                }

                const records = await store.listPending(3);
                expect(records).toHaveLength(3);
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 4. Claim Lifecycle
    // -----------------------------------------------------------------------

    describe('claimPending', () => {
        it('returns null when no pending records exist', async () => {
            const store = createStore();
            try {
                const batch = await store.claimPending();
                expect(batch).toBeNull();
            } finally {
                store.close();
            }
        });

        it('claims pending records and moves them to claimed status', async () => {
            const store = createStore();
            try {
                await store.append(makeInput({ content: 'fact 1' }));
                await store.append(makeInput({ content: 'fact 2' }));

                const batch = await store.claimPending(10);
                expect(batch).not.toBeNull();
                expect(batch!.batchId).toBeTruthy();
                expect(batch!.records).toHaveLength(2);
                expect(batch!.records[0].status).toBe('claimed');
                expect(batch!.records[0].batchId).toBe(batch!.batchId);
                expect(batch!.records[0].claimedAt).toBeTruthy();

                const stats = await store.getStats();
                expect(stats.pending).toBe(0);
                expect(stats.claimed).toBe(2);
            } finally {
                store.close();
            }
        });

        it('respects the limit parameter', async () => {
            const store = createStore();
            try {
                for (let i = 0; i < 5; i++) {
                    await store.append(makeInput({ content: `fact-${i}` }));
                }

                const batch = await store.claimPending(2);
                expect(batch!.records).toHaveLength(2);

                const stats = await store.getStats();
                expect(stats.pending).toBe(3);
                expect(stats.claimed).toBe(2);
            } finally {
                store.close();
            }
        });

        it('already-claimed records are not returned by subsequent claims', async () => {
            const store = createStore();
            try {
                for (let i = 0; i < 4; i++) {
                    await store.append(makeInput({ content: `fact-${i}` }));
                }

                const batch1 = await store.claimPending(2);
                const batch2 = await store.claimPending(2);

                expect(batch1!.batchId).not.toBe(batch2!.batchId);
                const ids1 = new Set(batch1!.records.map(r => r.id));
                const ids2 = new Set(batch2!.records.map(r => r.id));
                // No overlap
                for (const id of ids2) {
                    expect(ids1.has(id)).toBe(false);
                }
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 5. releaseClaim
    // -----------------------------------------------------------------------

    describe('releaseClaim', () => {
        it('returns claimed records to pending status', async () => {
            const store = createStore();
            try {
                await store.append(makeInput({ content: 'fact 1' }));
                await store.append(makeInput({ content: 'fact 2' }));

                const batch = await store.claimPending(10);
                expect((await store.getStats()).claimed).toBe(2);

                const released = await store.releaseClaim(batch!.batchId);
                expect(released).toBe(2);

                const stats = await store.getStats();
                expect(stats.pending).toBe(2);
                expect(stats.claimed).toBe(0);

                // Records should be claimable again
                const batch2 = await store.claimPending(10);
                expect(batch2!.records).toHaveLength(2);
            } finally {
                store.close();
            }
        });

        it('returns 0 when batch does not exist', async () => {
            const store = createStore();
            try {
                const released = await store.releaseClaim('nonexistent-batch');
                expect(released).toBe(0);
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 6. markAggregated
    // -----------------------------------------------------------------------

    describe('markAggregated', () => {
        it('moves claimed records to aggregated status', async () => {
            const store = createStore();
            try {
                await store.append(makeInput({ content: 'fact 1' }));
                const batch = await store.claimPending(10);

                const count = await store.markAggregated(batch!.batchId);
                expect(count).toBe(1);

                const stats = await store.getStats();
                expect(stats.aggregated).toBe(1);
                expect(stats.claimed).toBe(0);
                expect(stats.pending).toBe(0);
            } finally {
                store.close();
            }
        });

        it('aggregated records do not appear in pending queries', async () => {
            const store = createStore();
            try {
                await store.append(makeInput({ content: 'aggregated fact' }));
                await store.append(makeInput({ content: 'still pending' }));

                const batch = await store.claimPending(1);
                await store.markAggregated(batch!.batchId);

                const pending = await store.listPending();
                expect(pending).toHaveLength(1);
                expect(pending[0].content).toBe('still pending');
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 7. markDropped
    // -----------------------------------------------------------------------

    describe('markDropped', () => {
        it('moves claimed records to dropped status', async () => {
            const store = createStore();
            try {
                await store.append(makeInput({ content: 'low-value fact' }));
                const batch = await store.claimPending(10);

                const count = await store.markDropped(batch!.batchId);
                expect(count).toBe(1);

                const stats = await store.getStats();
                expect(stats.dropped).toBe(1);
                expect(stats.claimed).toBe(0);
            } finally {
                store.close();
            }
        });

        it('dropped records do not appear in pending queries', async () => {
            const store = createStore();
            try {
                await store.append(makeInput({ content: 'will drop' }));
                const batch = await store.claimPending(10);
                await store.markDropped(batch!.batchId);

                const pending = await store.listPending();
                expect(pending).toHaveLength(0);
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 8. getStats
    // -----------------------------------------------------------------------

    describe('getStats', () => {
        it('returns zeroes for an empty database', async () => {
            const store = createStore();
            try {
                const stats = await store.getStats();
                expect(stats).toEqual({
                    pending: 0,
                    claimed: 0,
                    aggregated: 0,
                    dropped: 0,
                    total: 0,
                });
            } finally {
                store.close();
            }
        });

        it('accurately reflects all status categories', async () => {
            const store = createStore();
            try {
                // 5 records: 2 pending, 1 claimed, 1 aggregated, 1 dropped
                for (let i = 0; i < 5; i++) {
                    await store.append(makeInput({ content: `fact-${i}` }));
                }

                // Claim 3, aggregate 1, drop 1, release 1 → 3 pending, 1 aggregated, 1 dropped
                const b1 = await store.claimPending(1);
                await store.markAggregated(b1!.batchId);

                const b2 = await store.claimPending(1);
                await store.markDropped(b2!.batchId);

                const b3 = await store.claimPending(1);
                await store.releaseClaim(b3!.batchId);

                const stats = await store.getStats();
                expect(stats.pending).toBe(3);
                expect(stats.claimed).toBe(0);
                expect(stats.aggregated).toBe(1);
                expect(stats.dropped).toBe(1);
                expect(stats.total).toBe(5);
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 9. Duplicate fingerprints
    // -----------------------------------------------------------------------

    describe('Duplicate Fingerprints', () => {
        it('allows records with the same fingerprint (no uniqueness constraint)', async () => {
            const store = createStore();
            try {
                const r1 = await store.append(makeInput({
                    content: 'version A',
                    fingerprint: 'fp-same',
                }));
                const r2 = await store.append(makeInput({
                    content: 'version B',
                    fingerprint: 'fp-same',
                }));

                expect(r1.id).not.toBe(r2.id);
                expect(r1.fingerprint).toBe('fp-same');
                expect(r2.fingerprint).toBe('fp-same');

                const stats = await store.getStats();
                expect(stats.total).toBe(2);
            } finally {
                store.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 10. Concurrent store instances (no double-claim)
    // -----------------------------------------------------------------------

    describe('Concurrent Access', () => {
        it('two store instances against the same DB do not double-claim', async () => {
            const store1 = createStore();
            const store2 = createStore();
            try {
                // Append 4 records via store1
                for (let i = 0; i < 4; i++) {
                    await store1.append(makeInput({ content: `fact-${i}` }));
                }

                // Each store claims 2
                const batch1 = await store1.claimPending(2);
                const batch2 = await store2.claimPending(2);

                expect(batch1).not.toBeNull();
                expect(batch2).not.toBeNull();

                const ids1 = new Set(batch1!.records.map(r => r.id));
                const ids2 = new Set(batch2!.records.map(r => r.id));

                // No overlap
                for (const id of ids2) {
                    expect(ids1.has(id)).toBe(false);
                }

                // All 4 should be claimed
                const stats = await store1.getStats();
                expect(stats.claimed).toBe(4);
                expect(stats.pending).toBe(0);
            } finally {
                store1.close();
                store2.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 11. Restart safety (reopen after close)
    // -----------------------------------------------------------------------

    describe('Restart Safety', () => {
        it('records persist across store close/reopen', async () => {
            const store1 = createStore();
            await store1.append(makeInput({ content: 'persistent fact' }));
            const batch = await store1.claimPending(1);
            store1.close();

            const store2 = createStore();
            try {
                const stats = await store2.getStats();
                expect(stats.total).toBe(1);
                expect(stats.claimed).toBe(1);

                // Release and re-claim
                await store2.releaseClaim(batch!.batchId);
                const pending = await store2.listPending();
                expect(pending).toHaveLength(1);
                expect(pending[0].content).toBe('persistent fact');
            } finally {
                store2.close();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 12. Isolation — separate DB files are independent
    // -----------------------------------------------------------------------

    describe('Scope Isolation', () => {
        it('repo-scoped and system-scoped stores are independent', async () => {
            const repoDbPath = path.join(tmpDir, 'repo', 'raw-records.db');
            const systemDbPath = path.join(tmpDir, 'system', 'raw-records.db');

            const repoStore = createStore(repoDbPath);
            const systemStore = createStore(systemDbPath);

            try {
                await repoStore.append(makeInput({ target: 'repo', content: 'repo fact' }));
                await systemStore.append(makeInput({ target: 'system', content: 'system fact' }));

                const repoStats = await repoStore.getStats();
                const systemStats = await systemStore.getStats();

                expect(repoStats.total).toBe(1);
                expect(systemStats.total).toBe(1);

                const repoPending = await repoStore.listPending();
                expect(repoPending[0].content).toBe('repo fact');

                const systemPending = await systemStore.listPending();
                expect(systemPending[0].content).toBe('system fact');
            } finally {
                repoStore.close();
                systemStore.close();
            }
        });
    });
});
