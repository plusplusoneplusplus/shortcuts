/**
 * Data Exporter Tests (coc-server)
 *
 * Unit tests for exportAllData() from coc-server/src/data-exporter.ts.
 * Focuses on coc-server-specific behavior: wiki data inclusion.
 *
 * Note: The coc package's test/server/data-exporter.test.ts also imports
 * exportAllData from @plusplusoneplusplus/coc-server and covers the base
 * export path. These tests add direct coc-server-package coverage and
 * test wiki-specific export behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { exportAllData } from '../src/data-exporter';
import { EXPORT_SCHEMA_VERSION } from '../src/export-import-types';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coc-server-exporter-test-'));
}

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Tests
// ============================================================================

describe('exportAllData (coc-server)', () => {
    let dataDir: string;
    let store: FileProcessStore;

    beforeEach(() => {
        dataDir = createTempDir();
        store = new FileProcessStore({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns a valid payload with EXPORT_SCHEMA_VERSION', async () => {
        const payload = await exportAllData({ store, dataDir });
        expect(payload.version).toBe(EXPORT_SCHEMA_VERSION);
        expect(typeof payload.exportedAt).toBe('string');
    });

    it('exports zero counts for empty store', async () => {
        const payload = await exportAllData({ store, dataDir });
        expect(payload.metadata.processCount).toBe(0);
        expect(payload.metadata.workspaceCount).toBe(0);
        expect(payload.metadata.wikiCount).toBe(0);
        expect(payload.metadata.queueFileCount).toBe(0);
        expect(payload.metadata.blobFileCount).toBe(0);
    });

    it('includes processes in export', async () => {
        await store.addProcess({
            id: 'p1',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            type: 'clarification',
        } as any);

        const payload = await exportAllData({ store, dataDir });
        expect(payload.metadata.processCount).toBe(1);
        expect(payload.processes).toHaveLength(1);
        expect(payload.processes[0].id).toBe('p1');
    });

    it('includes wiki data in export when wikis exist in store', async () => {
        await store.registerWiki({
            id: 'wiki-1',
            name: 'My Wiki',
            wikiDir: path.join(dataDir, 'wikis', 'wiki-1'),
            registeredAt: new Date().toISOString(),
        });

        const payload = await exportAllData({ store, dataDir });
        expect(payload.metadata.wikiCount).toBe(1);
        expect(payload.wikis).toHaveLength(1);
        expect(payload.wikis[0].id).toBe('wiki-1');
    });

    it('includes queue history when queue files exist', async () => {
        const queuesDir = path.join(dataDir, 'queues');
        writeJSON(path.join(queuesDir, 'repo-abc.json'), {
            repoRootPath: '/some/repo',
            repoId: 'repo-abc',
            pending: [],
            history: [],
        });

        const payload = await exportAllData({ store, dataDir });
        expect(payload.metadata.queueFileCount).toBe(1);
        expect(payload.queueHistory).toHaveLength(1);
        expect(payload.queueHistory[0].repoId).toBe('repo-abc');
    });

    it('skips corrupt queue files gracefully', async () => {
        const queuesDir = path.join(dataDir, 'queues');
        fs.mkdirSync(queuesDir, { recursive: true });
        fs.writeFileSync(path.join(queuesDir, 'repo-corrupt.json'), 'NOT VALID JSON', 'utf-8');

        const payload = await exportAllData({ store, dataDir });
        // Corrupt file is skipped — count stays at 0
        expect(payload.metadata.queueFileCount).toBe(0);
    });

    it('includes preferences when preferences file exists', async () => {
        const prefFile = path.join(dataDir, 'preferences.json');
        fs.writeFileSync(prefFile, JSON.stringify({ theme: 'dark' }), 'utf-8');

        const payload = await exportAllData({ store, dataDir });
        expect((payload.preferences as any).theme).toBe('dark');
    });

    it('includes serverVersion when provided', async () => {
        const payload = await exportAllData({ store, dataDir, serverVersion: '1.2.3' });
        expect(payload.serverVersion).toBe('1.2.3');
    });
});
