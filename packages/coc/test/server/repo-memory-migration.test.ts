/**
 * Tests for repo-memory-migration.
 *
 * Verifies the one-time migration from hash-based to workspaceId-based
 * repo-level pipeline memory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { computeRepoHash } from '@plusplusoneplusplus/forge';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../../src/server/memory/memory-config-handler';
import { migrateRepoMemory, migrateMemoryToSubfolders } from '../../src/server/memory/repo-memory-migration';
import { getRepoDataPath } from '../../src/server/paths';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

const WORKSPACE_ID = 'ws-migrate-1';
const REPO_PATH = '/repos/migrate-project';

function makeStore(workspaces: Array<{ id: string; rootPath: string }> = []): ProcessStore {
    return {
        getWorkspaces: vi.fn().mockResolvedValue(workspaces.map(ws => ({
            ...ws,
            name: path.basename(ws.rootPath),
        }))),
        addProcess: vi.fn(),
        updateProcess: vi.fn(),
        getProcess: vi.fn(),
        getAllProcesses: vi.fn().mockResolvedValue([]),
        removeProcess: vi.fn(),
        clearProcesses: vi.fn(),
        registerWorkspace: vi.fn(),
        removeWorkspace: vi.fn(),
        updateWorkspace: vi.fn(),
        getWikis: vi.fn().mockResolvedValue([]),
        registerWiki: vi.fn(),
        removeWiki: vi.fn(),
        updateWiki: vi.fn(),
        clearAllWorkspaces: vi.fn(),
        clearAllWikis: vi.fn(),
        getStorageStats: vi.fn().mockResolvedValue({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
        onProcessOutput: vi.fn().mockReturnValue(() => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        emitProcessEvent: vi.fn(),
    } as unknown as ProcessStore;
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-memory-migration-test-'));
    writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('migrateRepoMemory', () => {
    it('returns empty result when no old repos directory exists', async () => {
        const result = await migrateRepoMemory(tmpDir, makeStore());
        expect(result.migrated).toBe(0);
        expect(result.skippedAlreadyMigrated).toBe(0);
        expect(result.skippedUnmatched).toBe(0);
        expect(result.details).toEqual([]);
    });

    it('returns empty result when repos directory is empty', async () => {
        const reposDir = path.join(tmpDir, 'memory', 'repos');
        fs.mkdirSync(reposDir, { recursive: true });

        const result = await migrateRepoMemory(tmpDir, makeStore());
        expect(result.migrated).toBe(0);
    });

    it('migrates consolidated.md and raw files to new location', async () => {
        const hash = computeRepoHash(REPO_PATH);
        const oldDir = path.join(tmpDir, 'memory', 'repos', hash);
        const rawDir = path.join(oldDir, 'raw');
        fs.mkdirSync(rawDir, { recursive: true });
        fs.writeFileSync(path.join(oldDir, 'consolidated.md'), '# Facts\n- fact 1', 'utf-8');
        fs.writeFileSync(path.join(oldDir, 'index.json'), '{"lastAggregation":null,"rawCount":1}', 'utf-8');
        fs.writeFileSync(path.join(rawDir, '2026-01-01T00-00-00.000Z-test.md'), '---\npipeline: test\n---\n\n- raw fact', 'utf-8');

        const store = makeStore([{ id: WORKSPACE_ID, rootPath: REPO_PATH }]);
        const result = await migrateRepoMemory(tmpDir, store);

        expect(result.migrated).toBe(1);
        expect(result.skippedUnmatched).toBe(0);

        // Verify files at new location
        const newDir = getRepoDataPath(tmpDir, WORKSPACE_ID, path.join('memory', 'pipeline'));
        expect(fs.readFileSync(path.join(newDir, 'consolidated.md'), 'utf-8')).toBe('# Facts\n- fact 1');
        expect(fs.readFileSync(path.join(newDir, 'index.json'), 'utf-8')).toContain('lastAggregation');
        expect(fs.readFileSync(path.join(newDir, 'raw', '2026-01-01T00-00-00.000Z-test.md'), 'utf-8')).toContain('raw fact');

        // Verify .migrated marker
        expect(fs.existsSync(path.join(oldDir, '.migrated'))).toBe(true);
    });

    it('does not clobber existing files at destination', async () => {
        const hash = computeRepoHash(REPO_PATH);
        const oldDir = path.join(tmpDir, 'memory', 'repos', hash);
        fs.mkdirSync(oldDir, { recursive: true });
        fs.writeFileSync(path.join(oldDir, 'consolidated.md'), 'old version', 'utf-8');

        // Pre-create destination with different content
        const newDir = getRepoDataPath(tmpDir, WORKSPACE_ID, path.join('memory', 'pipeline'));
        fs.mkdirSync(newDir, { recursive: true });
        fs.writeFileSync(path.join(newDir, 'consolidated.md'), 'existing content', 'utf-8');

        const store = makeStore([{ id: WORKSPACE_ID, rootPath: REPO_PATH }]);
        const result = await migrateRepoMemory(tmpDir, store);

        expect(result.migrated).toBe(1);
        // The existing file should not be overwritten
        expect(fs.readFileSync(path.join(newDir, 'consolidated.md'), 'utf-8')).toBe('existing content');
    });

    it('skips already-migrated directories', async () => {
        const hash = computeRepoHash(REPO_PATH);
        const oldDir = path.join(tmpDir, 'memory', 'repos', hash);
        fs.mkdirSync(oldDir, { recursive: true });
        fs.writeFileSync(path.join(oldDir, 'consolidated.md'), 'data', 'utf-8');
        // Write marker
        fs.writeFileSync(path.join(oldDir, '.migrated'), '2026-01-01T00:00:00.000Z', 'utf-8');

        const store = makeStore([{ id: WORKSPACE_ID, rootPath: REPO_PATH }]);
        const result = await migrateRepoMemory(tmpDir, store);

        expect(result.migrated).toBe(0);
        expect(result.skippedAlreadyMigrated).toBe(1);
        expect(result.details[0].status).toBe('already_migrated');
    });

    it('skips unmatched hash directories', async () => {
        const unknownDir = path.join(tmpDir, 'memory', 'repos', 'deadbeef12345678');
        fs.mkdirSync(unknownDir, { recursive: true });
        fs.writeFileSync(path.join(unknownDir, 'consolidated.md'), 'orphan data', 'utf-8');

        // No workspaces registered
        const result = await migrateRepoMemory(tmpDir, makeStore());

        expect(result.migrated).toBe(0);
        expect(result.skippedUnmatched).toBe(1);
        expect(result.details[0].status).toBe('unmatched');
        expect(result.details[0].hash).toBe('deadbeef12345678');
    });

    it('handles multiple repos with mixed statuses', async () => {
        const hash1 = computeRepoHash('/repos/alpha');
        const hash2 = computeRepoHash('/repos/beta');
        const unknownHash = 'deadbeef12345678';

        // hash1: fresh, should be migrated
        const dir1 = path.join(tmpDir, 'memory', 'repos', hash1);
        fs.mkdirSync(dir1, { recursive: true });
        fs.writeFileSync(path.join(dir1, 'consolidated.md'), 'alpha facts', 'utf-8');

        // hash2: already migrated
        const dir2 = path.join(tmpDir, 'memory', 'repos', hash2);
        fs.mkdirSync(dir2, { recursive: true });
        fs.writeFileSync(path.join(dir2, '.migrated'), 'done', 'utf-8');

        // unknownHash: no workspace match
        const dir3 = path.join(tmpDir, 'memory', 'repos', unknownHash);
        fs.mkdirSync(dir3, { recursive: true });
        fs.writeFileSync(path.join(dir3, 'consolidated.md'), 'orphan', 'utf-8');

        const store = makeStore([
            { id: 'ws-alpha', rootPath: '/repos/alpha' },
            { id: 'ws-beta', rootPath: '/repos/beta' },
        ]);
        const result = await migrateRepoMemory(tmpDir, store);

        expect(result.migrated).toBe(1);
        expect(result.skippedAlreadyMigrated).toBe(1);
        expect(result.skippedUnmatched).toBe(1);
        expect(result.details).toHaveLength(3);
    });

    it('is idempotent — running twice does not duplicate', async () => {
        const hash = computeRepoHash(REPO_PATH);
        const oldDir = path.join(tmpDir, 'memory', 'repos', hash);
        fs.mkdirSync(oldDir, { recursive: true });
        fs.writeFileSync(path.join(oldDir, 'consolidated.md'), 'data', 'utf-8');

        const store = makeStore([{ id: WORKSPACE_ID, rootPath: REPO_PATH }]);

        const result1 = await migrateRepoMemory(tmpDir, store);
        expect(result1.migrated).toBe(1);

        const result2 = await migrateRepoMemory(tmpDir, store);
        expect(result2.migrated).toBe(0);
        expect(result2.skippedAlreadyMigrated).toBe(1);
    });

    it('does not delete old data after migration', async () => {
        const hash = computeRepoHash(REPO_PATH);
        const oldDir = path.join(tmpDir, 'memory', 'repos', hash);
        fs.mkdirSync(oldDir, { recursive: true });
        fs.writeFileSync(path.join(oldDir, 'consolidated.md'), 'keep me', 'utf-8');

        const store = makeStore([{ id: WORKSPACE_ID, rootPath: REPO_PATH }]);
        await migrateRepoMemory(tmpDir, store);

        // Old file should still exist
        expect(fs.readFileSync(path.join(oldDir, 'consolidated.md'), 'utf-8')).toBe('keep me');
    });

    it('reports filesCopied count correctly', async () => {
        const hash = computeRepoHash(REPO_PATH);
        const oldDir = path.join(tmpDir, 'memory', 'repos', hash);
        const rawDir = path.join(oldDir, 'raw');
        fs.mkdirSync(rawDir, { recursive: true });
        fs.writeFileSync(path.join(oldDir, 'consolidated.md'), 'c', 'utf-8');
        fs.writeFileSync(path.join(oldDir, 'index.json'), '{}', 'utf-8');
        fs.writeFileSync(path.join(rawDir, 'a.md'), 'a', 'utf-8');
        fs.writeFileSync(path.join(rawDir, 'b.md'), 'b', 'utf-8');

        const store = makeStore([{ id: WORKSPACE_ID, rootPath: REPO_PATH }]);
        const result = await migrateRepoMemory(tmpDir, store);

        const detail = result.details.find(d => d.hash === hash)!;
        expect(detail.filesCopied).toBe(4); // consolidated.md + index.json + 2 raw
    });
});

// ── migrateMemoryToSubfolders ─────────────────────────────────────────────────

describe('migrateMemoryToSubfolders', () => {
    it('returns empty result when repos dir does not exist', async () => {
        const result = await migrateMemoryToSubfolders(tmpDir);
        expect(result.migrated).toBe(0);
        expect(result.skipped).toBe(0);
    });

    it('separates array index.json (notes) and UUID files into notes/', async () => {
        const wsId = 'ws-sub-1';
        const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });

        // Note files
        const noteId = '12345678-1234-1234-1234-123456789abc';
        fs.writeFileSync(path.join(memDir, `${noteId}.json`), '{"content":"hello"}', 'utf-8');
        fs.writeFileSync(path.join(memDir, 'index.json'), JSON.stringify([{ id: noteId }]), 'utf-8');

        const result = await migrateMemoryToSubfolders(tmpDir);
        expect(result.migrated).toBe(1);

        // Note file moved
        expect(fs.existsSync(path.join(memDir, 'notes', `${noteId}.json`))).toBe(true);
        expect(fs.existsSync(path.join(memDir, `${noteId}.json`))).toBe(false);
        // Note index written
        const noteIndex = JSON.parse(fs.readFileSync(path.join(memDir, 'notes', 'index.json'), 'utf-8'));
        expect(Array.isArray(noteIndex)).toBe(true);
        // Old index.json removed
        expect(fs.existsSync(path.join(memDir, 'index.json'))).toBe(false);
        // Marker written
        expect(fs.existsSync(path.join(memDir, '.memory-separated'))).toBe(true);
    });

    it('separates object index.json (pipeline) and pipeline files into pipeline/', async () => {
        const wsId = 'ws-sub-2';
        const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
        const rawDir = path.join(memDir, 'raw');
        fs.mkdirSync(rawDir, { recursive: true });

        fs.writeFileSync(path.join(rawDir, 'obs.md'), '# fact', 'utf-8');
        fs.writeFileSync(path.join(memDir, 'consolidated.md'), '# consolidated', 'utf-8');
        fs.writeFileSync(path.join(memDir, 'consolidated.prev.md'), '# prev', 'utf-8');
        fs.writeFileSync(
            path.join(memDir, 'index.json'),
            JSON.stringify({ lastAggregation: '2026-01-01T00:00:00Z', rawCount: 1, factCount: 1, categories: [] }),
            'utf-8',
        );

        const result = await migrateMemoryToSubfolders(tmpDir);
        expect(result.migrated).toBe(1);

        // Pipeline files moved
        expect(fs.existsSync(path.join(memDir, 'pipeline', 'raw', 'obs.md'))).toBe(true);
        expect(fs.existsSync(path.join(memDir, 'pipeline', 'consolidated.md'))).toBe(true);
        expect(fs.existsSync(path.join(memDir, 'pipeline', 'consolidated.prev.md'))).toBe(true);
        // Pipeline index
        const pipelineIndex = JSON.parse(fs.readFileSync(path.join(memDir, 'pipeline', 'index.json'), 'utf-8'));
        expect(pipelineIndex.lastAggregation).toBe('2026-01-01T00:00:00Z');
        // Old files cleaned up
        expect(fs.existsSync(path.join(memDir, 'raw'))).toBe(false);
        expect(fs.existsSync(path.join(memDir, 'consolidated.md'))).toBe(false);
        expect(fs.existsSync(path.join(memDir, 'index.json'))).toBe(false);
    });

    it('skips already-separated directories (has marker)', async () => {
        const wsId = 'ws-sub-3';
        const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, '.memory-separated'), '2026-01-01', 'utf-8');

        const result = await migrateMemoryToSubfolders(tmpDir);
        expect(result.skipped).toBe(1);
        expect(result.migrated).toBe(0);
    });

    it('is idempotent — running twice does not fail', async () => {
        const wsId = 'ws-sub-4';
        const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, 'consolidated.md'), '# data', 'utf-8');
        fs.writeFileSync(
            path.join(memDir, 'index.json'),
            JSON.stringify({ lastAggregation: null, rawCount: 0, factCount: 0, categories: [] }),
            'utf-8',
        );

        const r1 = await migrateMemoryToSubfolders(tmpDir);
        expect(r1.migrated).toBe(1);

        const r2 = await migrateMemoryToSubfolders(tmpDir);
        expect(r2.migrated).toBe(0);
        expect(r2.skipped).toBe(1);
    });

    it('handles corrupted index.json gracefully', async () => {
        const wsId = 'ws-sub-5';
        const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, 'index.json'), '{invalid json', 'utf-8');
        fs.writeFileSync(path.join(memDir, 'consolidated.md'), '# data', 'utf-8');

        const result = await migrateMemoryToSubfolders(tmpDir);
        expect(result.migrated).toBe(1);
        // consolidated.md should still be moved to pipeline
        expect(fs.existsSync(path.join(memDir, 'pipeline', 'consolidated.md'))).toBe(true);
        // Corrupted index.json stays in place (not moved to either subfolder)
        expect(fs.existsSync(path.join(memDir, 'index.json'))).toBe(true);
    });

    it('skips workspaces without a memory directory', async () => {
        const wsId = 'ws-sub-6';
        fs.mkdirSync(path.join(tmpDir, 'repos', wsId), { recursive: true });
        // No memory/ dir

        const result = await migrateMemoryToSubfolders(tmpDir);
        expect(result.migrated).toBe(0);
        expect(result.skipped).toBe(0);
    });
});
