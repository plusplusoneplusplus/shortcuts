/**
 * Tests for RalphSessionStore.extendSession and appendContinuationMarker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import type { RalphSessionRecord } from '../../../src/server/ralph/types';

const WS = 'ws-extend';
const SID = 'sess-extend';

let dataDir: string;
let store: RalphSessionStore;

beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-extend-test-'));
    store = new RalphSessionStore({ dataDir });
    await store.initSession(WS, SID, {
        originalGoal: 'Original goal text',
        maxIterations: 10,
        startedAt: '2026-05-11T00:00:00Z',
    });
    // Manually mark the session as terminal/CAP_REACHED at iteration 10.
    await store.updateSessionRecord(WS, SID, (rec): RalphSessionRecord => ({
        ...(rec as RalphSessionRecord),
        currentIteration: 10,
        phase: 'complete',
        completedAt: '2026-05-11T03:00:00Z',
        terminalReason: 'CAP_REACHED',
    }));
});

afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('RalphSessionStore.extendSession', () => {
    it('increases maxIterations by addBy and resets phase to executing', async () => {
        const updated = await store.extendSession(WS, SID, 5);
        expect(updated.maxIterations).toBe(15);
        expect(updated.phase).toBe('executing');
        expect(updated.completedAt).toBeUndefined();
        expect(updated.terminalReason).toBeUndefined();
        expect(updated.currentIteration).toBe(10);
    });

    it('persists across reads', async () => {
        await store.extendSession(WS, SID, 7);
        const rec = await store.readSessionRecord(WS, SID);
        expect(rec).not.toBeNull();
        expect(rec!.maxIterations).toBe(17);
        expect(rec!.phase).toBe('executing');
    });

    it('rejects non-positive addBy', async () => {
        await expect(store.extendSession(WS, SID, 0)).rejects.toThrow(/positive integer/);
        await expect(store.extendSession(WS, SID, -3)).rejects.toThrow(/positive integer/);
        await expect(store.extendSession(WS, SID, 1.5)).rejects.toThrow(/positive integer/);
    });

    it('throws when the session does not exist', async () => {
        await expect(store.extendSession(WS, 'nonexistent', 5)).rejects.toThrow(/not found/);
    });
});

describe('RalphSessionStore.appendContinuationMarker', () => {
    it('appends a "Loop continued" banner to progress.md', async () => {
        await store.appendContinuationMarker(WS, SID, 30, '2026-05-11T04:00:00Z');
        const md = await store.readProgress(WS, SID);
        expect(md).toMatch(/---\n## Loop continued at 2026-05-11T04:00:00Z — extending to 30/);
    });

    it('is idempotent against double-appends with the same (newMax, timestamp)', async () => {
        await store.appendContinuationMarker(WS, SID, 30, '2026-05-11T04:00:00Z');
        await store.appendContinuationMarker(WS, SID, 30, '2026-05-11T04:00:00Z');
        const md = await store.readProgress(WS, SID);
        const occurrences = md.match(/Loop continued at 2026-05-11T04:00:00Z — extending to 30/g) ?? [];
        expect(occurrences.length).toBe(1);
    });

    it('appends a fresh marker when the timestamp differs', async () => {
        await store.appendContinuationMarker(WS, SID, 30, '2026-05-11T04:00:00Z');
        await store.appendContinuationMarker(WS, SID, 50, '2026-05-11T05:00:00Z');
        const md = await store.readProgress(WS, SID);
        expect(md).toMatch(/extending to 30/);
        expect(md).toMatch(/extending to 50/);
    });
});
