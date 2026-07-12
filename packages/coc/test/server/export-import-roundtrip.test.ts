/**
 * Export/Import Round-Trip Fidelity Tests
 *
 * Section 8: Verifies that an export-wipe-import-re-export cycle preserves all
 * data fields without truncation, corruption, or inadvertent resets.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { exportAllData, importData, DataWiper, EXPORT_SCHEMA_VERSION } from '@plusplusoneplusplus/coc-server';
import type { CoCExportPayload, ImportOptions } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-test-'));
}

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
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

// ============================================================================
// Tests
// ============================================================================

describe('Export/Import Round-Trip Fidelity — Section 8', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let wiper: DataWiper;

    beforeEach(async () => {
        dataDir = createTempDir();
        store = new FileProcessStore({ dataDir });
        wiper = new DataWiper(dataDir, store);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function baseOptions(overrides: Partial<ImportOptions> = {}): ImportOptions {
        return { store, dataDir, mode: 'replace', wiper, ...overrides };
    }

    // ========================================================================
    // Round-trip: processes by ID
    // ========================================================================

    it('export → wipe → import → re-export: both exports contain the same processes by ID', async () => {
        // Seed processes
        const processes = [
            { id: 'rp1', type: 'clarification' as const, promptPreview: 'prompt 1', fullPrompt: 'full 1', status: 'completed' as const, startTime: new Date() },
            { id: 'rp2', type: 'clarification' as const, promptPreview: 'prompt 2', fullPrompt: 'full 2', status: 'running' as const, startTime: new Date() },
        ];
        for (const p of processes) { await store.addProcess(p as any); }

        // First export
        const export1 = await exportAllData({ store, dataDir });
        const ids1 = export1.processes.map(p => p.id).sort();

        // Wipe then import
        await importData(export1, baseOptions());

        // Re-export
        const export2 = await exportAllData({ store, dataDir });
        const ids2 = export2.processes.map(p => p.id).sort();

        expect(ids1).toEqual(['rp1', 'rp2']);
        expect(ids2).toEqual(ids1);
    });

    // ========================================================================
    // Output content preservation
    // ========================================================================

    it('process result content is preserved through round-trip (not truncated)', async () => {
        const longResult = 'A'.repeat(10000); // 10 KB of result content
        await store.addProcess({
            id: 'result-proc',
            type: 'clarification' as const,
            promptPreview: 'test',
            fullPrompt: 'test full',
            status: 'completed' as const,
            startTime: new Date(),
            result: longResult,
        } as any);

        const exported = await exportAllData({ store, dataDir });
        await importData(exported, baseOptions());
        const reExported = await exportAllData({ store, dataDir });

        const proc = reExported.processes.find(p => p.id === 'result-proc');
        expect(proc).toBeDefined();
        expect((proc as any).result).toBe(longResult);
    });

    // ========================================================================
    // Preference preservation
    // ========================================================================

    it('preference values are preserved through round-trip', async () => {
        // Write preferences to disk before export (using global wrapper format)
        fs.writeFileSync(
            path.join(dataDir, 'preferences.json'),
            JSON.stringify({ global: { lastModel: 'gpt-4-turbo', lastDepth: 'deep', customPref: 'preserved' } }),
            'utf-8',
        );

        const exported = await exportAllData({ store, dataDir });
        expect(exported.preferences).toBeDefined();

        // Wipe and reimport
        await importData(exported, baseOptions());

        // Preferences should be restored
        const prefsPath = path.join(dataDir, 'preferences.json');
        expect(fs.existsSync(prefsPath)).toBe(true);
        const restored = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
        expect(restored.global.lastModel).toBe('gpt-4-turbo');
        expect(restored.global.lastDepth).toBe('deep');
        expect(restored.global.customPref).toBe('preserved');
    });

    // ========================================================================
    // Timestamp preservation
    // ========================================================================

    it('process.startTime timestamp is preserved (not reset on import)', async () => {
        const originalTime = new Date('2024-01-15T10:30:00.000Z');
        await store.addProcess({
            id: 'ts-proc',
            type: 'clarification' as const,
            promptPreview: 'ts test',
            fullPrompt: 'ts full',
            status: 'completed' as const,
            startTime: originalTime,
        } as any);

        const exported = await exportAllData({ store, dataDir });
        await importData(exported, baseOptions());

        const all = await store.getAllProcesses();
        const proc = all.find(p => p.id === 'ts-proc');
        expect(proc).toBeDefined();
        // startTime should match the original (may be string after JSON round-trip)
        const restoredTime = new Date(proc!.startTime as any);
        expect(restoredTime.toISOString()).toBe(originalTime.toISOString());
    });

    // ========================================================================
    // Queue history preservation
    // ========================================================================

    it('queue history is preserved through round-trip', async () => {
        writeJSON(path.join(dataDir, 'repos', 'abc123', 'queues.json'), {
            version: 3,
            repoRootPath: '/projects/repo',
            repoId: 'abc123',
            pending: [],
            history: [{ id: 'task-1', status: 'completed', resolvedPrompt: 'do something' }],
            isPaused: false,
        });

        const exported = await exportAllData({ store, dataDir });
        expect(exported.queueHistory).toHaveLength(1);
        expect(exported.queueHistory[0].history[0].resolvedPrompt).toBe('do something');

        // Wipe and reimport
        await importData(exported, baseOptions());

        // Re-export and verify queue is still there
        const reExported = await exportAllData({ store, dataDir });
        expect(reExported.queueHistory).toHaveLength(1);
        const restoredTask = reExported.queueHistory[0].history[0] as any;
        expect(restoredTask.resolvedPrompt).toBe('do something');
    });

    it('schedule YAML and run rows are preserved through round-trip', async () => {
        const sqliteDataDir = createTempDir();
        const sqliteStore = new SqliteProcessStore({ dbPath: path.join(sqliteDataDir, 'processes.db') });
        const sqliteWiper = new DataWiper(sqliteDataDir, sqliteStore);
        try {
            const schedulesDir = path.join(sqliteDataDir, 'repos', 'repo-schedule', 'schedules');
            fs.mkdirSync(schedulesDir, { recursive: true });
            fs.writeFileSync(
                path.join(schedulesDir, 'sched-1.yaml'),
                [
                    'id: sched-1',
                    'name: Daily',
                    'cron: "0 8 * * *"',
                    'prompt: Run daily check',
                ].join('\n'),
                'utf-8',
            );
            writeJSON(path.join(sqliteDataDir, 'repos', 'repo-schedule', 'queues.json'), {
                version: 3,
                repoRootPath: '/projects/repo-schedule',
                repoId: 'repo-schedule',
                pending: [],
                history: [],
            });
            sqliteStore.getDatabase()
                .prepare('INSERT INTO schedule_runs (id, schedule_id, repo_id, started_at, completed_at, status, duration_ms, process_id, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(
                    'run-1',
                    'sched-1',
                    'repo-schedule',
                    '2026-03-01T00:00:00.000Z',
                    '2026-03-01T00:01:00.000Z',
                    'completed',
                    60000,
                    'proc-1',
                    'task-1',
                );

            const exported = await exportAllData({ store: sqliteStore, dataDir: sqliteDataDir });
            expect(exported.scheduleHistory).toHaveLength(1);
            expect(exported.scheduleHistory![0].repoRootPath).toBe('/projects/repo-schedule');
            expect(exported.scheduleHistory![0].schedules).toHaveLength(1);
            expect(exported.scheduleHistory![0].scheduleRuns).toHaveLength(1);

            await importData(exported, {
                store: sqliteStore,
                dataDir: sqliteDataDir,
                mode: 'replace',
                wiper: sqliteWiper,
            });
            const reExported = await exportAllData({ store: sqliteStore, dataDir: sqliteDataDir });

            expect(reExported.scheduleHistory).toHaveLength(1);
            expect((reExported.scheduleHistory![0].schedules[0] as any).id).toBe('sched-1');
            expect((reExported.scheduleHistory![0].scheduleRuns[0] as any).id).toBe('run-1');
            const runCount = (sqliteStore.getDatabase().prepare('SELECT COUNT(*) as cnt FROM schedule_runs').get() as { cnt: number }).cnt;
            expect(runCount).toBe(1);
        } finally {
            sqliteStore.close();
            fs.rmSync(sqliteDataDir, { recursive: true, force: true });
        }
    });
});
