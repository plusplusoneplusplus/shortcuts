/**
 * Verifies the builder resolves the shared `processes.db` handle correctly:
 * - reuses the SqliteProcessStore handle (rows visible on the same DB)
 * - falls back to opening `processes.db` under dataDir for non-SQLite stores
 * - dispose closes only an owned handle
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessStore, TurnPerformanceEvent } from '@plusplusoneplusplus/forge';
import { createTurnPerformanceInfrastructure } from '../../../src/server/infrastructure/turn-performance-infrastructure';

function makeEvent(): TurnPerformanceEvent {
    return {
        id: 'proc-1:0',
        processId: 'proc-1',
        turnIndex: 0,
        workspaceId: null,
        provider: 'claude',
        model: null,
        effortTier: null,
        mode: 'ask',
        kind: 'chat',
        enqueuedAt: null,
        startedAt: '2026-08-20T10:00:00.000Z',
        firstOutputAt: '2026-08-20T10:00:02.000Z',
        endedAt: '2026-08-20T10:00:10.000Z',
        ttftMs: 2000,
        queueWaitMs: null,
        generationMs: 8000,
        wallMs: 10000,
        inputTokens: null,
        outputTokens: 400,
        totalTokens: null,
        tpsGeneration: 50,
        tpsWall: 40,
        status: 'completed',
    };
}

describe('createTurnPerformanceInfrastructure', () => {
    let tmpDir: string | undefined;

    afterEach(() => {
        if (tmpDir) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            tmpDir = undefined;
        }
    });

    it('reuses the SqliteProcessStore handle', () => {
        const store = new SqliteProcessStore({ dbPath: ':memory:' });
        const infra = createTurnPerformanceInfrastructure('/unused-data-dir', store);

        expect(infra.turnPerformanceStore.isEnabled()).toBe(true);
        expect(infra.turnPerformanceStore.record(makeEvent())).toBe(true);

        // The row landed on the store's own handle, not a separate database.
        const row = store.getDatabase()
            .prepare('SELECT process_id FROM turn_performance WHERE id = ?')
            .get('proc-1:0') as { process_id: string } | undefined;
        expect(row?.process_id).toBe('proc-1');

        // Dispose must not close the borrowed handle.
        infra.dispose();
        expect(() => store.getDatabase().prepare('SELECT 1').get()).not.toThrow();
    });

    it('opens processes.db under dataDir for non-SQLite stores and closes it on dispose', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-perf-infra-'));
        const nonSqliteStore = {} as unknown as ProcessStore;

        const infra = createTurnPerformanceInfrastructure(tmpDir, nonSqliteStore);
        expect(infra.turnPerformanceStore.record(makeEvent())).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'processes.db'))).toBe(true);

        infra.dispose();
        // The owned handle is closed: further writes fail safely (record → false).
        expect(infra.turnPerformanceStore.record(makeEvent())).toBe(false);
    });
});
