/**
 * Tests for data-wiper — DataWiper getDryRunSummary and wipeData.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataWiper } from '../src/data-wiper';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiper-test-'));
}

function createMockStore(overrides: Partial<ProcessStore> = {}): ProcessStore {
    return {
        addProcess: async () => {},
        updateProcess: async () => {},
        getProcess: async () => undefined,
        getAllProcesses: async () => [],
        removeProcess: async () => {},
        clearProcesses: async () => 0,
        getWorkspaces: async () => [],
        registerWorkspace: async () => {},
        removeWorkspace: async () => false,
        updateWorkspace: async () => undefined,
        getWikis: async () => [],
        registerWiki: async () => {},
        removeWiki: async () => false,
        updateWiki: async () => undefined,
        clearAllWorkspaces: async () => 0,
        clearAllWikis: async () => 0,
        getStorageStats: async () => ({ totalProcesses: 3, totalWorkspaces: 2, totalWikis: 1, storageSize: 0 }),
        onProcessOutput: () => () => {},
        emitProcessOutput: () => {},
        emitProcessComplete: () => {},
        emitProcessEvent: () => {},
        ...overrides,
    };
}

// ============================================================================
// DataWiper
// ============================================================================

describe('DataWiper', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = createTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('dry-run returns correct counts without deleting', async () => {
        // Create queue files
        const queuesDir = path.join(tmpDir, 'queues');
        fs.mkdirSync(queuesDir);
        fs.writeFileSync(path.join(queuesDir, 'repo-abc.json'), '{}');
        fs.writeFileSync(path.join(queuesDir, 'repo-def.json'), '{}');

        // Create blob file
        const blobsDir = path.join(tmpDir, 'blobs');
        fs.mkdirSync(blobsDir);
        fs.writeFileSync(path.join(blobsDir, 'task1.images.json'), '[]');

        // Create preferences
        fs.writeFileSync(path.join(tmpDir, 'preferences.json'), '{}');

        const store = createMockStore();
        const wiper = new DataWiper(tmpDir, store);
        const result = await wiper.getDryRunSummary({ includeWikis: false });

        expect(result.deletedProcesses).toBe(3);
        expect(result.deletedWorkspaces).toBe(2);
        expect(result.deletedWikis).toBe(1);
        expect(result.deletedQueues).toBe(2);
        expect(result.deletedBlobs).toBe(1);
        expect(result.deletedPreferences).toBe(true);

        // Files should not be deleted in dry-run
        expect(fs.existsSync(path.join(queuesDir, 'repo-abc.json'))).toBe(true);
        expect(fs.existsSync(path.join(blobsDir, 'task1.images.json'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'preferences.json'))).toBe(true);
    });

    it('wipeData deletes queue files, blobs and preferences', async () => {
        const queuesDir = path.join(tmpDir, 'queues');
        fs.mkdirSync(queuesDir);
        fs.writeFileSync(path.join(queuesDir, 'repo-xyz.json'), '{}');

        const blobsDir = path.join(tmpDir, 'blobs');
        fs.mkdirSync(blobsDir);
        fs.writeFileSync(path.join(blobsDir, 'task2.images.json'), '[]');

        fs.writeFileSync(path.join(tmpDir, 'preferences.json'), '{}');

        const store = createMockStore();
        const wiper = new DataWiper(tmpDir, store);
        const result = await wiper.wipeData({ includeWikis: false });

        expect(result.errors).toHaveLength(0);
        expect(fs.existsSync(path.join(queuesDir, 'repo-xyz.json'))).toBe(false);
        expect(fs.existsSync(path.join(blobsDir, 'task2.images.json'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'preferences.json'))).toBe(false);
    });

    it('preserves config.yaml', async () => {
        const configPath = path.join(tmpDir, 'config.yaml');
        fs.writeFileSync(configPath, 'model: gpt-4\n');

        const store = createMockStore();
        const wiper = new DataWiper(tmpDir, store);
        const result = await wiper.getDryRunSummary();

        expect(result.preservedFiles).toContain(configPath);
    });

    it('returns zero counts when data dir is empty', async () => {
        const store = createMockStore({
            getStorageStats: async () => ({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
        });
        const wiper = new DataWiper(tmpDir, store);
        const result = await wiper.getDryRunSummary();

        expect(result.deletedQueues).toBe(0);
        expect(result.deletedBlobs).toBe(0);
        expect(result.deletedPreferences).toBe(false);
    });
});
