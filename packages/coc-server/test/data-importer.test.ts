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
});
