/**
 * Data Importer Tests
 *
 * Validates importData():
 * - Invalid payload throws error
 * - Replace mode wipes and restores processes, workspaces, wikis
 * - Replace mode restores queue files and preferences
 * - Replace mode resets queue manager and calls queue persistence restore
 * - Merge mode skips existing process/workspace/wiki IDs, adds new ones
 * - Merge mode merges queue files (dedup by task ID)
 * - Merge mode merges preferences
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { importData, DataWiper } from '@plusplusoneplusplus/coc-server';
import {
    EXPORT_SCHEMA_VERSION,
    type CoCExportPayload,
    type ImportOptions,
} from '@plusplusoneplusplus/coc-server';
import { readPreferences, readRepoPreferences, writePreferences } from '../../src/server/preferences-handler';
import { getRepoDataPath } from '../../src/server/paths';

/** Get the per-repo queue file path (legacy JSON format). */
function getRepoQueueFilePath(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'queues.json');
}

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'data-importer-test-'));
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

describe('importData', () => {
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
    // Validation
    // ========================================================================

    describe('validation', () => {
        it('throws on invalid payload (null)', async () => {
            await expect(
                importData(null as any, baseOptions()),
            ).rejects.toThrow('Invalid payload');
        });

        it('throws on payload with wrong version', async () => {
            const payload = buildPayload({ version: 999 } as any);
            await expect(
                importData(payload, baseOptions()),
            ).rejects.toThrow('Invalid payload');
        });

        it('throws on payload missing required fields', async () => {
            const payload = { version: EXPORT_SCHEMA_VERSION } as any;
            await expect(
                importData(payload, baseOptions()),
            ).rejects.toThrow('Invalid payload');
        });
    });

    // ========================================================================
    // Replace mode
    // ========================================================================

    describe('replace mode', () => {
        it('wipes existing data and restores processes', async () => {
            // Seed existing data
            await store.addProcess({
                id: 'old-p1', type: 'clarification', promptPreview: 'old',
                fullPrompt: 'old', status: 'completed', startTime: new Date(),
            });

            const payload = buildPayload({
                processes: [
                    { id: 'new-p1', type: 'clarification', promptPreview: 'new', fullPrompt: 'new', status: 'completed', startTime: new Date() } as any,
                    { id: 'new-p2', type: 'clarification', promptPreview: 'new2', fullPrompt: 'new2', status: 'running', startTime: new Date() } as any,
                ],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedProcesses).toBe(2);
            expect(result.errors).toEqual([]);

            const processes = await store.getAllProcesses();
            expect(processes).toHaveLength(2);
            expect(processes.map(p => p.id).sort()).toEqual(['new-p1', 'new-p2']);
        });

        it('wipes existing data and restores workspaces', async () => {
            await store.registerWorkspace({ id: 'old-ws', name: 'Old', rootPath: '/old' });

            const payload = buildPayload({
                workspaces: [
                    { id: 'new-ws1', name: 'WS1', rootPath: '/ws1' },
                    { id: 'new-ws2', name: 'WS2', rootPath: '/ws2' },
                ],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedWorkspaces).toBe(2);
            const workspaces = await store.getWorkspaces();
            expect(workspaces).toHaveLength(2);
        });

        it('wipes existing data and restores wikis', async () => {
            await store.registerWiki({
                id: 'old-w', name: 'Old Wiki', wikiDir: '/old',
                aiEnabled: false, registeredAt: new Date().toISOString(),
            });

            const payload = buildPayload({
                wikis: [
                    { id: 'new-w1', name: 'Wiki1', wikiDir: '/wiki1', aiEnabled: false, registeredAt: new Date().toISOString() },
                ],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedWikis).toBe(1);
            const wikis = await store.getWikis();
            expect(wikis).toHaveLength(1);
            expect(wikis[0].id).toBe('new-w1');
        });

        it('restores queue files to disk', async () => {
            const payload = buildPayload({
                queueHistory: [
                    {
                        repoRootPath: '/projects/frontend',
                        repoId: 'ws-frontend',
                        pending: [{ id: 'q1', type: 'pipeline', status: 'queued' } as any],
                        history: [{ id: 'q0', type: 'pipeline', status: 'completed' } as any],
                    },
                ],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedQueueFiles).toBe(1);

            const filePath = getRepoQueueFilePath(dataDir, 'ws-frontend');
            expect(fs.existsSync(filePath)).toBe(true);

            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(raw.pending).toHaveLength(1);
            expect(raw.history).toHaveLength(1);
            expect(raw.version).toBe(3);
        });

        it('restores preferences', async () => {
            const payload = buildPayload({
                preferences: { global: { theme: 'dark' } },
            });

            await importData(payload, baseOptions());

            const prefs = readPreferences(dataDir);
            expect(prefs).toEqual({ global: { theme: 'dark' } });
        });

        it('resets queue manager when provided', async () => {
            const mockQueueManager = { reset: vi.fn() };

            const payload = buildPayload();
            await importData(payload, baseOptions({
                getQueueManager: () => mockQueueManager as any,
            }));

            expect(mockQueueManager.reset).toHaveBeenCalledOnce();
        });

        it('calls queue persistence restore when provided', async () => {
            const mockQueuePersistence = { restore: vi.fn() };

            const payload = buildPayload();
            await importData(payload, baseOptions({
                getQueuePersistence: () => mockQueuePersistence as any,
            }));

            expect(mockQueuePersistence.restore).toHaveBeenCalledOnce();
        });

        it('returns empty counts for empty payload', async () => {
            const payload = buildPayload();

            const result = await importData(payload, baseOptions());

            expect(result.importedProcesses).toBe(0);
            expect(result.importedWorkspaces).toBe(0);
            expect(result.importedWikis).toBe(0);
            expect(result.importedQueueFiles).toBe(0);
            expect(result.importedBlobFiles).toBe(0);
            expect(result.errors).toEqual([]);
        });

        it('writes blob files to blobs/ directory from payload imageBlobs', async () => {
            const payload = buildPayload({
                imageBlobs: [
                    { taskId: 'task-1', images: ['data:image/png;base64,abc'] },
                    { taskId: 'task-2', images: ['data:image/png;base64,def', 'data:image/png;base64,ghi'] },
                ],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedBlobFiles).toBe(2);
            const blob1 = path.join(dataDir, 'blobs', 'task-1.images.json');
            const blob2 = path.join(dataDir, 'blobs', 'task-2.images.json');
            expect(fs.existsSync(blob1)).toBe(true);
            expect(fs.existsSync(blob2)).toBe(true);
            expect(JSON.parse(fs.readFileSync(blob1, 'utf-8'))).toEqual(['data:image/png;base64,abc']);
            expect(JSON.parse(fs.readFileSync(blob2, 'utf-8'))).toHaveLength(2);
        });

        it('wipe clears existing blob files before writing new ones', async () => {
            // Pre-existing blob
            const blobsDir = path.join(dataDir, 'blobs');
            fs.mkdirSync(blobsDir, { recursive: true });
            fs.writeFileSync(path.join(blobsDir, 'old-task.images.json'), '["old"]', 'utf-8');

            const payload = buildPayload({
                imageBlobs: [
                    { taskId: 'new-task', images: ['new-img'] },
                ],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedBlobFiles).toBe(1);
            expect(fs.existsSync(path.join(blobsDir, 'old-task.images.json'))).toBe(false);
            expect(fs.existsSync(path.join(blobsDir, 'new-task.images.json'))).toBe(true);
        });

        it('handles empty imageBlobs gracefully', async () => {
            const payload = buildPayload({ imageBlobs: [] });

            const result = await importData(payload, baseOptions());

            expect(result.importedBlobFiles).toBe(0);
            expect(result.errors).toEqual([]);
        });

        it('handles payload without imageBlobs field (backward compat)', async () => {
            const payload = buildPayload();
            delete (payload as any).imageBlobs;

            const result = await importData(payload, baseOptions());

            expect(result.importedBlobFiles).toBe(0);
            expect(result.errors).toEqual([]);
        });

        it('restores per-repo preferences through validation helpers', async () => {
            const payload = buildPayload({
                repoPreferences: [{
                    repoId: 'ws-prefs',
                    repoRootPath: '/repo',
                    preferences: {
                        lastDepth: 'deep',
                        disabledLlmTools: ['create_bug', 'ask_user'],
                        unknownField: 'dropped',
                    },
                }],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedRepoPreferenceFiles).toBe(1);
            expect(readRepoPreferences(dataDir, 'ws-prefs')).toEqual({
                lastDepth: 'deep',
                disabledLlmTools: ['ask_user'],
            });

            const raw = JSON.parse(fs.readFileSync(getRepoDataPath(dataDir, 'ws-prefs', 'preferences.json'), 'utf-8'));
            expect(raw.unknownField).toBeUndefined();
            expect(raw.disabledLlmTools).toEqual(['ask_user']);
        });

        it('restores schedule YAML files and schedule run rows', async () => {
            const sqliteDir = createTempDir();
            const sqliteStore = new SqliteProcessStore({ dbPath: path.join(sqliteDir, 'processes.db') });
            const sqliteWiper = new DataWiper(sqliteDir, sqliteStore);
            try {
                const payload = buildPayload({
                    scheduleHistory: [{
                        repoId: 'repo-schedule',
                        repoRootPath: '/repo',
                        schedules: [{
                            id: 'sched-1',
                            name: 'Daily',
                            cron: '0 8 * * *',
                            prompt: 'Run daily check',
                        }],
                        scheduleRuns: [{
                            id: 'run-1',
                            scheduleId: 'sched-1',
                            repoId: 'repo-schedule',
                            startedAt: '2026-03-01T00:00:00.000Z',
                            completedAt: '2026-03-01T00:01:00.000Z',
                            status: 'completed',
                            durationMs: 60000,
                            processId: 'proc-1',
                            taskId: 'task-1',
                        }],
                    }],
                });

                const result = await importData(payload, {
                    store: sqliteStore,
                    dataDir: sqliteDir,
                    mode: 'replace',
                    wiper: sqliteWiper,
                });

                expect(result.importedScheduleFiles).toBe(1);
                expect(fs.existsSync(getRepoDataPath(sqliteDir, 'repo-schedule', path.join('schedules', 'sched-1.yaml')))).toBe(true);
                const row = sqliteStore.getDatabase()
                    .prepare('SELECT * FROM schedule_runs WHERE id = ?')
                    .get('run-1') as { schedule_id: string; repo_id: string; status: string; task_id: string };
                expect(row).toMatchObject({
                    schedule_id: 'sched-1',
                    repo_id: 'repo-schedule',
                    status: 'completed',
                    task_id: 'task-1',
                });
            } finally {
                sqliteStore.close();
                fs.rmSync(sqliteDir, { recursive: true, force: true });
            }
        });
    });

    // ========================================================================
    // Merge mode
    // ========================================================================

    describe('merge mode', () => {
        it('skips existing process IDs, adds new ones', async () => {
            await store.addProcess({
                id: 'existing-p', type: 'clarification', promptPreview: 'existing',
                fullPrompt: 'existing', status: 'completed', startTime: new Date(),
            });

            const payload = buildPayload({
                processes: [
                    { id: 'existing-p', type: 'clarification', promptPreview: 'dup', fullPrompt: 'dup', status: 'completed', startTime: new Date() } as any,
                    { id: 'new-p', type: 'clarification', promptPreview: 'new', fullPrompt: 'new', status: 'completed', startTime: new Date() } as any,
                ],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedProcesses).toBe(1);
            const processes = await store.getAllProcesses();
            expect(processes).toHaveLength(2);
        });

        it('skips existing workspace IDs, adds new ones', async () => {
            await store.registerWorkspace({ id: 'existing-ws', name: 'Existing', rootPath: '/existing' });

            const payload = buildPayload({
                workspaces: [
                    { id: 'existing-ws', name: 'Dup', rootPath: '/dup' },
                    { id: 'new-ws', name: 'New', rootPath: '/new' },
                ],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedWorkspaces).toBe(1);
            const workspaces = await store.getWorkspaces();
            expect(workspaces).toHaveLength(2);
        });

        it('skips existing wiki IDs, adds new ones', async () => {
            await store.registerWiki({
                id: 'existing-w', name: 'Existing', wikiDir: '/existing',
                aiEnabled: false, registeredAt: new Date().toISOString(),
            });

            const payload = buildPayload({
                wikis: [
                    { id: 'existing-w', name: 'Dup', wikiDir: '/dup', aiEnabled: false, registeredAt: new Date().toISOString() },
                    { id: 'new-w', name: 'New', wikiDir: '/new', aiEnabled: false, registeredAt: new Date().toISOString() },
                ],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedWikis).toBe(1);
            const wikis = await store.getWikis();
            expect(wikis).toHaveLength(2);
        });

        it('merges queue files — deduplicates by task ID', async () => {
            const rootPath = '/projects/frontend';
            const repoId = 'ws-frontend';
            // Write existing queue file
            const existingFilePath = getRepoQueueFilePath(dataDir, repoId);
            writeJSON(existingFilePath, {
                version: 3,
                repoRootPath: rootPath,
                repoId,
                pending: [{ id: 'existing-q1', type: 'pipeline', status: 'queued' }],
                history: [{ id: 'existing-h1', type: 'pipeline', status: 'completed' }],
                isPaused: false,
            });

            const payload = buildPayload({
                queueHistory: [{
                    repoRootPath: rootPath,
                    repoId,
                    pending: [
                        { id: 'existing-q1', type: 'pipeline', status: 'queued' } as any,
                        { id: 'new-q1', type: 'pipeline', status: 'queued' } as any,
                    ],
                    history: [
                        { id: 'existing-h1', type: 'pipeline', status: 'completed' } as any,
                        { id: 'new-h1', type: 'pipeline', status: 'completed' } as any,
                    ],
                }],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedQueueFiles).toBe(1);

            const raw = JSON.parse(fs.readFileSync(existingFilePath, 'utf-8'));
            expect(raw.pending).toHaveLength(2); // existing-q1 + new-q1
            expect(raw.history).toHaveLength(2); // existing-h1 + new-h1
        });

        it('creates queue file for new repo in merge mode', async () => {
            const payload = buildPayload({
                queueHistory: [{
                    repoRootPath: '/projects/new-repo',
                    repoId: 'ws-newrepo',
                    pending: [{ id: 'q1', type: 'pipeline', status: 'queued' } as any],
                    history: [],
                }],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedQueueFiles).toBe(1);
            const filePath = getRepoQueueFilePath(dataDir, 'ws-newrepo');
            expect(fs.existsSync(filePath)).toBe(true);
        });

        it('merges preferences with existing', async () => {
            writePreferences(dataDir, { global: { theme: 'light' } });

            const payload = buildPayload({
                preferences: { global: { theme: 'dark' } },
            });

            await importData(payload, baseOptions({ mode: 'merge' }));

            const prefs = readPreferences(dataDir);
            expect(prefs.global?.theme).toBe('dark');
        });

        it('preserves existing preferences when payload has empty prefs', async () => {
            writePreferences(dataDir, { global: { theme: 'light' } });

            const payload = buildPayload({ preferences: {} });

            await importData(payload, baseOptions({ mode: 'merge' }));

            const prefs = readPreferences(dataDir);
            expect(prefs.global?.theme).toBe('light');
        });

        it('adds all items when store is empty', async () => {
            const payload = buildPayload({
                processes: [
                    { id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date() } as any,
                ],
                workspaces: [{ id: 'ws1', name: 'WS1', rootPath: '/ws1' }],
                wikis: [{ id: 'w1', name: 'Wiki1', wikiDir: '/w1', aiEnabled: false, registeredAt: new Date().toISOString() }],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedProcesses).toBe(1);
            expect(result.importedWorkspaces).toBe(1);
            expect(result.importedWikis).toBe(1);
        });

        it('skips existing blob files, writes only new ones', async () => {
            const blobsDir = path.join(dataDir, 'blobs');
            fs.mkdirSync(blobsDir, { recursive: true });
            fs.writeFileSync(path.join(blobsDir, 'existing-task.images.json'), '["existing-img"]', 'utf-8');

            const payload = buildPayload({
                imageBlobs: [
                    { taskId: 'existing-task', images: ['should-not-overwrite'] },
                    { taskId: 'new-task', images: ['new-img'] },
                ],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedBlobFiles).toBe(1);
            // Existing file should not be overwritten
            const existingContent = JSON.parse(fs.readFileSync(path.join(blobsDir, 'existing-task.images.json'), 'utf-8'));
            expect(existingContent).toEqual(['existing-img']);
            // New file should be written
            expect(fs.existsSync(path.join(blobsDir, 'new-task.images.json'))).toBe(true);
        });

        it('writes all blob files when blobs dir is empty', async () => {
            const payload = buildPayload({
                imageBlobs: [
                    { taskId: 'task-1', images: ['img1'] },
                    { taskId: 'task-2', images: ['img2'] },
                ],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedBlobFiles).toBe(2);
            expect(fs.existsSync(path.join(dataDir, 'blobs', 'task-1.images.json'))).toBe(true);
            expect(fs.existsSync(path.join(dataDir, 'blobs', 'task-2.images.json'))).toBe(true);
        });

        it('handles missing imageBlobs in payload (merge mode)', async () => {
            const payload = buildPayload();
            delete (payload as any).imageBlobs;

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedBlobFiles).toBe(0);
            expect(result.errors).toEqual([]);
        });

        it('merges per-repo preferences through validation helpers', async () => {
            writeJSON(getRepoDataPath(dataDir, 'ws-prefs', 'preferences.json'), {
                lastModel: 'gpt-4',
                disabledLlmTools: ['memory'],
            });
            const payload = buildPayload({
                repoPreferences: [{
                    repoId: 'ws-prefs',
                    repoRootPath: '/repo',
                    preferences: {
                        disabledLlmTools: ['create_bug', 'ask_user'],
                        unknownField: 'dropped',
                    },
                }],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedRepoPreferenceFiles).toBe(1);
            expect(readRepoPreferences(dataDir, 'ws-prefs')).toEqual({
                lastModel: 'gpt-4',
                disabledLlmTools: ['ask_user'],
            });
            const raw = JSON.parse(fs.readFileSync(getRepoDataPath(dataDir, 'ws-prefs', 'preferences.json'), 'utf-8'));
            expect(raw.unknownField).toBeUndefined();
        });

        it('merges per-repo preferences with the API PATCH merge policy', async () => {
            writeJSON(getRepoDataPath(dataDir, 'ws-prefs', 'preferences.json'), {
                lastSkills: { task: ['impl'], ask: ['go-deep'] },
                lastModels: { task: 'gpt-4' },
                defaultModel: 'gpt-4',
                defaultModels: { task: 'gpt-4', ask: 'claude-3' },
                activityFilters: { statusFilter: 'running' },
                workItems: {
                    sync: {
                        github: {
                            owner: 'plusplusoneplusplus',
                            repo: 'shortcuts',
                            pollingEnabled: true,
                        },
                    },
                },
                linkedRepoIds: ['ws-linked'],
                disabledLlmTools: ['memory'],
            });

            const payload = buildPayload({
                repoPreferences: [{
                    repoId: 'ws-prefs',
                    repoRootPath: '/repo',
                    preferences: {
                        lastSkills: { task: [] },
                        lastModels: { ask: 'claude-3' },
                        defaultModel: '',
                        defaultModels: { task: '' },
                        activityFilters: { typeFilter: 'chat' },
                        workItems: {
                            sync: {
                                github: {
                                    pollingEnabled: false,
                                    pollIntervalMinutes: 10,
                                },
                            },
                        },
                        linkedRepoIds: [],
                        disabledLlmTools: ['create_bug', 'ask_user'],
                    },
                }],
            });

            const result = await importData(payload, baseOptions({ mode: 'merge' }));

            expect(result.importedRepoPreferenceFiles).toBe(1);
            expect(readRepoPreferences(dataDir, 'ws-prefs')).toEqual({
                lastSkills: { ask: ['go-deep'] },
                lastModels: { task: 'gpt-4', ask: 'claude-3' },
                defaultModels: { ask: 'claude-3' },
                activityFilters: { statusFilter: 'running', typeFilter: 'chat' },
                workItems: {
                    sync: {
                        github: {
                            owner: 'plusplusoneplusplus',
                            repo: 'shortcuts',
                            pollingEnabled: false,
                            pollIntervalMinutes: 10,
                        },
                    },
                },
                disabledLlmTools: ['ask_user'],
            });
        });
    });

    // ========================================================================
    // Edge cases
    // ========================================================================

    describe('edge cases', () => {
        it('skips queue snapshots with empty repoRootPath', async () => {
            const payload = buildPayload({
                queueHistory: [{
                    repoRootPath: '',
                    repoId: 'ws-missing-root',
                    pending: [],
                    history: [],
                }],
            });

            const result = await importData(payload, baseOptions());
            expect(result.importedQueueFiles).toBe(0);
        });

        it('skips queue snapshots without repoId instead of deriving one', async () => {
            const payload = buildPayload({
                queueHistory: [{
                    repoRootPath: '/projects/missing-id',
                    pending: [{ id: 'q1', type: 'pipeline', status: 'queued' } as any],
                    history: [],
                } as any],
            });

            const result = await importData(payload, baseOptions());

            expect(result.importedQueueFiles).toBe(0);
            expect(fs.existsSync(getRepoQueueFilePath(dataDir, 'ws-missing-id'))).toBe(false);
        });

        it('handles replace mode with no optional callbacks', async () => {
            const payload = buildPayload({
                processes: [
                    { id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date() } as any,
                ],
            });

            // No getQueueManager or getQueuePersistence — should not throw
            const result = await importData(payload, baseOptions({
                getQueueManager: undefined,
                getQueuePersistence: undefined,
            }));

            expect(result.importedProcesses).toBe(1);
            expect(result.errors).toEqual([]);
        });
    });
});
