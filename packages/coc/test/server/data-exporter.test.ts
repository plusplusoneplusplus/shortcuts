/**
 * Data Exporter Tests
 *
 * Validates exportAllData():
 * - Empty store returns valid payload with zero counts
 * - Seeded processes/workspaces/wikis are included
 * - Queue files are included when present
 * - Preferences are included when present
 * - Server config is included when config.yaml exists
 * - Corrupt queue files are skipped gracefully
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { exportAllData } from '@plusplusoneplusplus/coc-server';
import { loadConfigFile } from '../../src/config';
import {
    validateExportPayload,
    EXPORT_SCHEMA_VERSION,
} from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'data-exporter-test-'));
}

function writeFile(filePath: string, data: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data, 'utf-8');
}

function writeJSON(filePath: string, data: unknown): void {
    writeFile(filePath, JSON.stringify(data, null, 2));
}

// ============================================================================
// Tests
// ============================================================================

describe('exportAllData', () => {
    let dataDir: string;
    let store: FileProcessStore;

    beforeEach(async () => {
        dataDir = createTempDir();
        store = new FileProcessStore({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ========================================================================
    // Empty store
    // ========================================================================

    it('returns a valid payload with zero counts for an empty store', async () => {
        const payload = await exportAllData({ store, dataDir });

        expect(payload.version).toBe(EXPORT_SCHEMA_VERSION);
        expect(typeof payload.exportedAt).toBe('string');
        expect(payload.metadata).toEqual({
            processCount: 0,
            workspaceCount: 0,
            wikiCount: 0,
            queueFileCount: 0,
            blobFileCount: 0,
        });
        expect(payload.processes).toEqual([]);
        expect(payload.workspaces).toEqual([]);
        expect(payload.wikis).toEqual([]);
        expect(payload.queueHistory).toEqual([]);
        expect(payload.preferences).toEqual({});
        expect(payload.serverConfig).toBeUndefined();
        expect(payload.serverVersion).toBeUndefined();

        // Must pass validation
        const validation = validateExportPayload(payload);
        expect(validation).toEqual({ valid: true });
    });

    // ========================================================================
    // Seeded processes, workspaces, wikis
    // ========================================================================

    it('includes seeded processes, workspaces, and wikis', async () => {
        await store.addProcess({
            id: 'p1', type: 'clarification', promptPreview: 'test',
            fullPrompt: 'test full', status: 'completed', startTime: new Date(),
        });
        await store.addProcess({
            id: 'p2', type: 'clarification', promptPreview: 'test2',
            fullPrompt: 'test2 full', status: 'running', startTime: new Date(),
        });
        await store.registerWorkspace({ id: 'ws1', name: 'WS1', rootPath: '/tmp/ws1' });
        await store.registerWiki({
            id: 'w1', name: 'Wiki1', wikiDir: '/tmp/wiki-out',
            aiEnabled: false, registeredAt: new Date().toISOString(),
        });

        const payload = await exportAllData({ store, dataDir });

        expect(payload.metadata.processCount).toBe(2);
        expect(payload.metadata.workspaceCount).toBe(1);
        expect(payload.metadata.wikiCount).toBe(1);
        expect(payload.processes).toHaveLength(2);
        expect(payload.workspaces).toHaveLength(1);
        expect(payload.wikis).toHaveLength(1);

        const validation = validateExportPayload(payload);
        expect(validation).toEqual({ valid: true });
    });

    // ========================================================================
    // Queue files
    // ========================================================================

    it('includes queue files when present', async () => {
        const queuesDir = path.join(dataDir, 'queues');
        writeJSON(path.join(queuesDir, 'repo-abc123.json'), {
            version: 3,
            repoRootPath: '/projects/frontend',
            repoId: 'abc123',
            pending: [{ id: 'q1', type: 'pipeline', status: 'queued' }],
            history: [{ id: 'q0', type: 'pipeline', status: 'completed' }],
            isPaused: false,
        });
        writeJSON(path.join(queuesDir, 'repo-def456.json'), {
            version: 3,
            repoRootPath: '/projects/backend',
            repoId: 'def456',
            pending: [],
            history: [],
            isPaused: true,
        });

        const payload = await exportAllData({ store, dataDir });

        expect(payload.metadata.queueFileCount).toBe(2);
        expect(payload.queueHistory).toHaveLength(2);

        const frontend = payload.queueHistory.find(q => q.repoId === 'abc123');
        expect(frontend).toBeDefined();
        expect(frontend!.repoRootPath).toBe('/projects/frontend');
        expect(frontend!.pending).toHaveLength(1);
        expect(frontend!.history).toHaveLength(1);

        const backend = payload.queueHistory.find(q => q.repoId === 'def456');
        expect(backend).toBeDefined();
        expect(backend!.isPaused).toBe(true);

        const validation = validateExportPayload(payload);
        expect(validation).toEqual({ valid: true });
    });

    // ========================================================================
    // Preferences
    // ========================================================================

    it('includes preferences when present', async () => {
        writeJSON(path.join(dataDir, 'preferences.json'), { global: { theme: 'dark' } });

        const payload = await exportAllData({ store, dataDir });

        expect(payload.preferences).toEqual({ global: { theme: 'dark' } });

        const validation = validateExportPayload(payload);
        expect(validation).toEqual({ valid: true });
    });

    // ========================================================================
    // Server config
    // ========================================================================

    it('includes serverConfig when config.yaml exists', async () => {
        writeFile(path.join(dataDir, 'config.yaml'), 'model: gpt-4\nparallel: 10\n');

        const payload = await exportAllData({ store, dataDir, loadConfigFile });

        expect(payload.serverConfig).toBeDefined();
        expect(payload.serverConfig!.model).toBe('gpt-4');
        expect(payload.serverConfig!.parallel).toBe(10);

        const validation = validateExportPayload(payload);
        expect(validation).toEqual({ valid: true });
    });

    it('omits serverConfig when config.yaml does not exist', async () => {
        const payload = await exportAllData({ store, dataDir });

        expect(payload.serverConfig).toBeUndefined();
    });

    // ========================================================================
    // Corrupt queue files
    // ========================================================================

    it('skips corrupt queue files and continues', async () => {
        const queuesDir = path.join(dataDir, 'queues');
        // One valid file
        writeJSON(path.join(queuesDir, 'repo-good1234.json'), {
            version: 3,
            repoRootPath: '/good',
            repoId: 'good1234',
            pending: [],
            history: [],
        });
        // One corrupt file (invalid JSON)
        writeFile(path.join(queuesDir, 'repo-bad56789.json'), '{corrupt json!!!');

        const payload = await exportAllData({ store, dataDir });

        // Only the valid queue should be included
        expect(payload.metadata.queueFileCount).toBe(1);
        expect(payload.queueHistory).toHaveLength(1);
        expect(payload.queueHistory[0].repoId).toBe('good1234');

        const validation = validateExportPayload(payload);
        expect(validation).toEqual({ valid: true });
    });

    // ========================================================================
    // Server version
    // ========================================================================

    it('includes serverVersion when provided', async () => {
        const payload = await exportAllData({ store, dataDir, serverVersion: '2.1.0' });

        expect(payload.serverVersion).toBe('2.1.0');
    });

    // ========================================================================
    // No queues directory
    // ========================================================================

    it('returns empty queueHistory when queues directory does not exist', async () => {
        const payload = await exportAllData({ store, dataDir });

        expect(payload.queueHistory).toEqual([]);
        expect(payload.metadata.queueFileCount).toBe(0);
    });

    // ========================================================================
    // Image blobs
    // ========================================================================

    it('includes imageBlobs and blobFileCount when blob files exist', async () => {
        const blobsDir = path.join(dataDir, 'blobs');
        writeJSON(path.join(blobsDir, 'task-abc.images.json'), ['data:image/png;base64,abc']);
        writeJSON(path.join(blobsDir, 'task-def.images.json'), ['data:image/png;base64,def', 'data:image/png;base64,ghi']);

        const payload = await exportAllData({ store, dataDir });

        expect(payload.metadata.blobFileCount).toBe(2);
        expect(payload.imageBlobs).toHaveLength(2);

        const abc = payload.imageBlobs!.find(b => b.taskId === 'task-abc');
        expect(abc).toBeDefined();
        expect(abc!.images).toEqual(['data:image/png;base64,abc']);

        const def = payload.imageBlobs!.find(b => b.taskId === 'task-def');
        expect(def).toBeDefined();
        expect(def!.images).toHaveLength(2);

        const validation = validateExportPayload(payload);
        expect(validation).toEqual({ valid: true });
    });

    it('returns empty imageBlobs and blobFileCount 0 when no blobs dir', async () => {
        const payload = await exportAllData({ store, dataDir });

        expect(payload.imageBlobs).toEqual([]);
        expect(payload.metadata.blobFileCount).toBe(0);
    });

    it('skips corrupt blob files and continues', async () => {
        const blobsDir = path.join(dataDir, 'blobs');
        writeJSON(path.join(blobsDir, 'task-good.images.json'), ['data:image/png;base64,abc']);
        writeFile(path.join(blobsDir, 'task-bad.images.json'), '{corrupt json!!!');

        const payload = await exportAllData({ store, dataDir });

        expect(payload.imageBlobs).toHaveLength(1);
        expect(payload.imageBlobs![0].taskId).toBe('task-good');
        expect(payload.metadata.blobFileCount).toBe(1);
    });

    it('extracts taskId from filename correctly', async () => {
        const blobsDir = path.join(dataDir, 'blobs');
        writeJSON(path.join(blobsDir, 'my-complex-task-id.images.json'), ['img1']);

        const payload = await exportAllData({ store, dataDir });

        expect(payload.imageBlobs).toHaveLength(1);
        expect(payload.imageBlobs![0].taskId).toBe('my-complex-task-id');
    });
});
