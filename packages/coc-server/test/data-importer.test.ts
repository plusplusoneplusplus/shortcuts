/**
 * Data Importer Tests (coc-server)
 *
 * Unit tests for importData() from coc-server/src/data-importer.ts.
 * Covers replace mode, merge mode, wiki import, and error cases.
 *
 * Note: The coc package's test/server/data-importer.test.ts also imports
 * importData from @plusplusoneplusplus/coc-server. These tests add direct
 * coc-server-package coverage and test wiki-specific import behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { importData } from '../src/data-importer';
import { DataWiper } from '../src/data-wiper';
import { EXPORT_SCHEMA_VERSION, type CoCExportPayload } from '../src/export-import-types';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coc-server-importer-test-'));
}

function makePayload(overrides: Partial<CoCExportPayload> = {}): CoCExportPayload {
    return {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        metadata: {
            processCount: 0,
            workspaceCount: 0,
            wikiCount: 0,
            queueFileCount: 0,
            blobFileCount: 0,
        },
        processes: [],
        workspaces: [],
        wikis: [],
        queueHistory: [],
        preferences: {},
        imageBlobs: [],
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('importData (coc-server)', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let wiper: DataWiper;

    beforeEach(() => {
        dataDir = createTempDir();
        store = new FileProcessStore({ dataDir });
        wiper = new DataWiper(dataDir, store);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ---- Validation -------------------------------------------------------

    it('throws for invalid payload', async () => {
        const badPayload = { not: 'a valid payload' } as unknown as CoCExportPayload;
        await expect(importData(badPayload, { store, dataDir, mode: 'replace', wiper }))
            .rejects.toThrow();
    });

    // ---- Replace mode -----------------------------------------------------

    it('imports processes in replace mode', async () => {
        const payload = makePayload({
            processes: [{ id: 'p1', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(), type: 'clarification' } as any],
            metadata: { processCount: 1, workspaceCount: 0, wikiCount: 0, queueFileCount: 0, blobFileCount: 0 },
        });

        const result = await importData(payload, { store, dataDir, mode: 'replace', wiper });
        expect(result.importedProcesses).toBe(1);
        const all = await store.getAllProcesses();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('p1');
    });

    it('imports wikis in replace mode', async () => {
        const payload = makePayload({
            wikis: [{ id: 'wiki-1', name: 'Test Wiki', wikiDir: '/tmp/wiki', registeredAt: new Date().toISOString() }],
            metadata: { processCount: 0, workspaceCount: 0, wikiCount: 1, queueFileCount: 0, blobFileCount: 0 },
        });

        const result = await importData(payload, { store, dataDir, mode: 'replace', wiper });
        expect(result.importedWikis).toBe(1);
        const wikis = await store.getWikis();
        expect(wikis).toHaveLength(1);
        expect(wikis[0].id).toBe('wiki-1');
    });

    it('replace mode wipes existing data before importing', async () => {
        // Pre-seed a process
        await store.addProcess({ id: 'old-p', promptPreview: 'old', fullPrompt: 'old', status: 'completed', startTime: new Date(), type: 'clarification' } as any);

        const payload = makePayload({
            processes: [{ id: 'new-p', promptPreview: 'new', fullPrompt: 'new', status: 'completed', startTime: new Date(), type: 'clarification' } as any],
            metadata: { processCount: 1, workspaceCount: 0, wikiCount: 0, queueFileCount: 0, blobFileCount: 0 },
        });

        await importData(payload, { store, dataDir, mode: 'replace', wiper });
        const all = await store.getAllProcesses();
        const ids = all.map(p => p.id);
        expect(ids).not.toContain('old-p');
        expect(ids).toContain('new-p');
    });

    // ---- Merge mode -------------------------------------------------------

    it('merge mode skips existing process IDs', async () => {
        await store.addProcess({ id: 'existing', promptPreview: 'x', fullPrompt: 'x', status: 'completed', startTime: new Date(), type: 'clarification' } as any);

        const payload = makePayload({
            processes: [
                { id: 'existing', promptPreview: 'dup', fullPrompt: 'dup', status: 'completed', startTime: new Date(), type: 'clarification' } as any,
                { id: 'new-one', promptPreview: 'new', fullPrompt: 'new', status: 'completed', startTime: new Date(), type: 'clarification' } as any,
            ],
            metadata: { processCount: 2, workspaceCount: 0, wikiCount: 0, queueFileCount: 0, blobFileCount: 0 },
        });

        const result = await importData(payload, { store, dataDir, mode: 'merge', wiper });
        // Only the new one is imported (existing ID is skipped)
        expect(result.importedProcesses).toBe(1);
    });

    it('merge mode skips existing wiki IDs', async () => {
        await store.registerWiki({ id: 'wiki-a', name: 'Existing', wikiDir: '/tmp/a', registeredAt: new Date().toISOString() });

        const payload = makePayload({
            wikis: [
                { id: 'wiki-a', name: 'Dup', wikiDir: '/tmp/a', registeredAt: new Date().toISOString() },
                { id: 'wiki-b', name: 'New', wikiDir: '/tmp/b', registeredAt: new Date().toISOString() },
            ],
            metadata: { processCount: 0, workspaceCount: 0, wikiCount: 2, queueFileCount: 0, blobFileCount: 0 },
        });

        const result = await importData(payload, { store, dataDir, mode: 'merge', wiper });
        expect(result.importedWikis).toBe(1);
    });

    it('returns errors array (no throw) for partial failures', async () => {
        // Force store to fail on addProcess
        const badStore = new FileProcessStore({ dataDir });
        const originalAdd = badStore.addProcess.bind(badStore);
        badStore.addProcess = async () => { throw new Error('disk full'); };

        const payload = makePayload({
            processes: [{ id: 'p1', promptPreview: 't', fullPrompt: 't', status: 'completed', startTime: new Date(), type: 'clarification' } as any],
            metadata: { processCount: 1, workspaceCount: 0, wikiCount: 0, queueFileCount: 0, blobFileCount: 0 },
        });

        const badWiper = new DataWiper(dataDir, badStore);
        const result = await importData(payload, { store: badStore, dataDir, mode: 'replace', wiper: badWiper });
        // Should have captured errors without throwing
        expect(Array.isArray(result.errors)).toBe(true);
    });

    // ---- Per-repo preferences -----------------------------------------------

    it('replace mode writes per-repo prefs to repos/<id>/preferences.json', async () => {
        const payload = makePayload({
            preferences: {
                global: { theme: 'dark' },
            },
            repoPreferences: [
                { repoId: 'ws-abc', repoRootPath: '/repo/abc', preferences: { lastModel: 'gpt-4' } },
                { repoId: 'ws-def', repoRootPath: '/repo/def', preferences: { lastModel: 'claude-3' } },
            ],
        });

        const result = await importData(payload, { store, dataDir, mode: 'replace', wiper });
        expect(result.importedRepoPreferenceFiles).toBe(2);
        const repoPrefsAbc = path.join(dataDir, 'repos', 'ws-abc', 'preferences.json');
        const repoPrefsDef = path.join(dataDir, 'repos', 'ws-def', 'preferences.json');
        expect(fs.existsSync(repoPrefsAbc)).toBe(true);
        expect(fs.existsSync(repoPrefsDef)).toBe(true);
        expect(JSON.parse(fs.readFileSync(repoPrefsAbc, 'utf-8')).lastModel).toBe('gpt-4');
        expect(JSON.parse(fs.readFileSync(repoPrefsDef, 'utf-8')).lastModel).toBe('claude-3');
    });

    it('merge mode shallow-merges per-repo preferences', async () => {
        // Pre-seed per-repo prefs
        const repoDir = path.join(dataDir, 'repos', 'ws-abc');
        fs.mkdirSync(repoDir, { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'preferences.json'), JSON.stringify({ lastModel: 'existing', theme: 'dark' }));

        const payload = makePayload({
            repoPreferences: [
                { repoId: 'ws-abc', repoRootPath: '/repo/abc', preferences: { lastModel: 'imported', newKey: 'value' } },
                { repoId: 'ws-new', repoRootPath: '/repo/new', preferences: { lastModel: 'new-model' } },
            ],
        });

        const result = await importData(payload, { store, dataDir, mode: 'merge', wiper });
        expect(result.importedRepoPreferenceFiles).toBe(2);
        // Merge: incoming keys win for conflicts, existing keys preserved
        const merged = JSON.parse(fs.readFileSync(path.join(repoDir, 'preferences.json'), 'utf-8'));
        expect(merged.lastModel).toBe('imported');
        expect(merged.theme).toBe('dark');
        expect(merged.newKey).toBe('value');
        // New per-repo prefs are written
        const newRepoPrefs = path.join(dataDir, 'repos', 'ws-new', 'preferences.json');
        expect(fs.existsSync(newRepoPrefs)).toBe(true);
        expect(JSON.parse(fs.readFileSync(newRepoPrefs, 'utf-8')).lastModel).toBe('new-model');
    });

    // ---- Schedule import -----------------------------------------------

    it('replace mode writes schedule files under correct repo dir', async () => {
        const payload = makePayload({
            scheduleHistory: [
                {
                    repoId: 'ws-abc', repoRootPath: '/repo/abc',
                    schedules: [{ id: 's1', cron: '0 * * * *' }],
                    scheduleRuns: [{ id: 'r1', scheduleId: 's1' }],
                },
            ],
        });

        const result = await importData(payload, { store, dataDir, mode: 'replace', wiper });
        expect(result.importedScheduleFiles).toBe(1);
        const schedulesFile = path.join(dataDir, 'repos', 'ws-abc', 'schedules.json');
        const runsFile = path.join(dataDir, 'repos', 'ws-abc', 'schedule-runs.json');
        expect(fs.existsSync(schedulesFile)).toBe(true);
        expect(fs.existsSync(runsFile)).toBe(true);
        expect(JSON.parse(fs.readFileSync(schedulesFile, 'utf-8'))).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(runsFile, 'utf-8'))).toHaveLength(1);
    });

    it('merge mode deduplicates schedules by id', async () => {
        // Pre-seed schedule files
        const repoDir = path.join(dataDir, 'repos', 'ws-abc');
        fs.mkdirSync(repoDir, { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'schedules.json'), JSON.stringify([{ id: 's1', cron: '0 * * * *' }]));
        fs.writeFileSync(path.join(repoDir, 'schedule-runs.json'), JSON.stringify([{ id: 'r1' }]));

        const payload = makePayload({
            scheduleHistory: [
                {
                    repoId: 'ws-abc', repoRootPath: '/repo/abc',
                    schedules: [{ id: 's1', cron: 'different' }, { id: 's2', cron: '*/5 * * * *' }],
                    scheduleRuns: [{ id: 'r1' }, { id: 'r2' }],
                },
            ],
        });

        const result = await importData(payload, { store, dataDir, mode: 'merge', wiper });
        expect(result.importedScheduleFiles).toBe(1);
        const schedules = JSON.parse(fs.readFileSync(path.join(repoDir, 'schedules.json'), 'utf-8'));
        const runs = JSON.parse(fs.readFileSync(path.join(repoDir, 'schedule-runs.json'), 'utf-8'));
        // s1 not duplicated, s2 added
        expect(schedules).toHaveLength(2);
        expect(runs).toHaveLength(2);
    });

    it('old payload without repoPreferences/scheduleHistory imports without error', async () => {
        const payload = makePayload({
            preferences: { global: { theme: 'dark' } },
        });
        // Ensure the new fields are absent
        delete (payload as any).repoPreferences;
        delete (payload as any).scheduleHistory;

        const result = await importData(payload, { store, dataDir, mode: 'replace', wiper });
        expect(result.errors).toHaveLength(0);
        expect(result.importedScheduleFiles).toBe(0);
        expect(result.importedRepoPreferenceFiles).toBe(0);
    });
});
