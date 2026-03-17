/**
 * Import Atomicity and Error Recovery Tests
 *
 * Section 5: Validates error recovery behavior when store writes fail mid-import,
 * and documents the known atomicity gap.
 *
 * KNOWN ATOMICITY GAP:
 * importData does NOT guarantee atomic replacement. The wipe step runs before
 * any write attempts. If subsequent writes fail (disk error, store error), the
 * store is left in a partially-imported or fully-wiped state. There is no
 * rollback to the pre-wipe state. This is intentional and documented here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { importData, DataWiper, EXPORT_SCHEMA_VERSION } from '@plusplusoneplusplus/coc-server';
import type { CoCExportPayload, ImportOptions } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'import-atomicity-test-'));
}

function buildPayload(overrides: Partial<CoCExportPayload> = {}): CoCExportPayload {
    const processes = overrides.processes ?? [];
    const workspaces = overrides.workspaces ?? [];
    const wikis = overrides.wikis ?? [];
    const queueHistory = overrides.queueHistory ?? [];
    return {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        metadata: {
            processCount: processes.length,
            workspaceCount: workspaces.length,
            wikiCount: wikis.length,
            queueFileCount: queueHistory.length,
        },
        processes,
        workspaces,
        wikis,
        queueHistory,
        preferences: overrides.preferences ?? {},
        ...overrides,
    };
}

function makeProcess(id: string) {
    return {
        id,
        type: 'clarification' as const,
        promptPreview: `prompt ${id}`,
        fullPrompt: `full prompt ${id}`,
        status: 'completed' as const,
        startTime: new Date(),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Import Atomicity and Error Recovery — Section 5', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let wiper: DataWiper;

    beforeEach(async () => {
        dataDir = createTempDir();
        store = new FileProcessStore({ dataDir });
        wiper = new DataWiper(dataDir, store);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function baseOptions(overrides: Partial<ImportOptions> = {}): ImportOptions {
        return { store, dataDir, mode: 'replace', wiper, ...overrides };
    }

    // ========================================================================
    // Error recovery: individual process write failures
    // ========================================================================

    it('records error for the failed process when store.addProcess throws on the 3rd call', async () => {
        const original = store.addProcess.bind(store);
        let callCount = 0;
        vi.spyOn(store, 'addProcess').mockImplementation(async (proc: any) => {
            callCount++;
            if (callCount === 3) {
                throw new Error('Simulated disk write error on 3rd process');
            }
            return original(proc);
        });

        const payload = buildPayload({
            processes: [
                makeProcess('p1'),
                makeProcess('p2'),
                makeProcess('p3'), // this one will fail
                makeProcess('p4'),
            ] as any[],
        });

        const result = await importData(payload, baseOptions());

        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('p3'))).toBe(true);
        // p1, p2, p4 succeed
        expect(result.importedProcesses).toBe(3);
    });

    it('after failed import, store contains only the successfully-written entries', async () => {
        const original = store.addProcess.bind(store);
        let callCount = 0;
        vi.spyOn(store, 'addProcess').mockImplementation(async (proc: any) => {
            callCount++;
            if (callCount === 3) {
                throw new Error('Simulated failure');
            }
            return original(proc);
        });

        const payload = buildPayload({
            processes: [
                makeProcess('p1'),
                makeProcess('p2'),
                makeProcess('p3'), // fails
            ] as any[],
        });

        await importData(payload, baseOptions());

        const all = await store.getAllProcesses();
        // p1 and p2 were written; p3 failed
        expect(all).toHaveLength(2);
        const ids = all.map(p => p.id).sort();
        expect(ids).toEqual(['p1', 'p2']);
    });

    it('failed import returns result with errors array containing the failure reason', async () => {
        vi.spyOn(store, 'addProcess').mockRejectedValue(new Error('disk full'));

        const payload = buildPayload({
            processes: [makeProcess('p1')] as any[],
        });

        const result = await importData(payload, baseOptions());

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('disk full');
        expect(result.importedProcesses).toBe(0);
    });

    // ========================================================================
    // Wipe-then-import atomicity boundary
    // ========================================================================

    describe('Wipe-then-import atomicity boundary (known gap)', () => {
        it('wipe succeeds then all imports fail → data is wiped (NOT rolled back to pre-wipe state)', async () => {
            // KNOWN ATOMICITY GAP:
            // importData (replace mode) wipes first, then writes. If all writes fail,
            // the store ends up empty — NOT restored to its pre-wipe state.
            // A transactional import (wipe + write as one atomic op) is NOT implemented.

            // Seed pre-import data
            await store.addProcess(makeProcess('pre-existing') as any);
            const before = await store.getAllProcesses();
            expect(before).toHaveLength(1);

            // Make all addProcess calls fail after the wipe
            vi.spyOn(store, 'addProcess').mockRejectedValue(new Error('all writes fail'));

            const payload = buildPayload({
                processes: [makeProcess('new-p1')] as any[],
            });

            await importData(payload, baseOptions());

            // Pre-existing data was wiped; new data failed to write → store is empty
            const after = await store.getAllProcesses();
            expect(after).toHaveLength(0);
        });
    });
});
