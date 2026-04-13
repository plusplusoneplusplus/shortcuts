/**
 * Startup Process History Migration Tests
 *
 * Validates automatic migration of file-based process histories
 * into SQLite on server startup:
 * - No-op for file-based backends, missing repos dir, no processes
 * - Happy path: single and multiple workspaces with active + pruned processes
 * - Idempotency via INSERT OR IGNORE + directory rename
 * - Partial failure: corrupt workspace doesn't block others
 * - Malformed JSON handling (index.json, process files)
 * - Missing process files referenced by index
 * - Workspace auto-registration for unregistered directories
 * - Directory rename to processes.migrated/ after success
 * - Logging output with [ProcessMigration] prefix
 * - Empty processes directory still gets renamed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { SqliteProcessStore, FileProcessStore } from '@plusplusoneplusplus/forge';
import type {
    ProcessIndexEntry,
    StoredProcessEntry,
    SerializedAIProcess,
    SerializedConversationTurn,
} from '@plusplusoneplusplus/forge';
import { migrateProcessHistoryIfNeeded } from '../../src/server/startup-process-migration';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'proc-migration-test-'));
}

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function makeTurn(index: number): SerializedConversationTurn {
    return {
        turnIndex: index,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `Turn ${index} content`,
        timestamp: '2024-01-15T10:00:00.000Z',
        streaming: false,
        timeline: [],
    };
}

function makeProcess(
    id: string,
    workspaceId: string,
    opts?: { turns?: SerializedConversationTurn[]; status?: string },
): { index: ProcessIndexEntry; stored: StoredProcessEntry } {
    const startTime = '2024-01-15T10:00:00.000Z';
    const endTime = '2024-01-15T10:05:00.000Z';
    const turns = opts?.turns ?? [];
    const status = opts?.status ?? 'completed';

    const serialized: SerializedAIProcess = {
        id,
        type: 'clarification',
        promptPreview: `Preview for ${id}`,
        fullPrompt: `Full prompt for ${id}`,
        status: status as SerializedAIProcess['status'],
        startTime,
        endTime,
        conversationTurns: turns,
        result: `Result for ${id}`,
    };

    const index: ProcessIndexEntry = {
        id,
        workspaceId,
        status,
        type: 'clarification',
        startTime,
        endTime,
        promptPreview: `Preview for ${id}`,
        duration: 300000,
    };

    const stored: StoredProcessEntry = {
        workspaceId,
        process: serialized,
    };

    return { index, stored };
}

// ============================================================================
// Tests
// ============================================================================

describe('migrateProcessHistoryIfNeeded', () => {
    let dataDir: string;
    let store: SqliteProcessStore;

    beforeEach(() => {
        dataDir = createTempDir();
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ========================================================================
    // No-op paths
    // ========================================================================

    it('is a no-op when store is FileProcessStore', async () => {
        const fileStore = new FileProcessStore({ dataDir });
        const result = await migrateProcessHistoryIfNeeded(dataDir, fileStore);
        expect(result).toEqual({
            migrated: false, workspaceCount: 0, processCount: 0, turnCount: 0, errors: [],
        });
    });

    it('is a no-op when repos/ directory does not exist', async () => {
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        expect(result).toEqual({
            migrated: false, workspaceCount: 0, processCount: 0, turnCount: 0, errors: [],
        });
    });

    it('is a no-op when repos/ exists but no workspace has processes/', async () => {
        const reposDir = path.join(dataDir, 'repos');
        fs.mkdirSync(path.join(reposDir, 'ws-1'), { recursive: true });
        // ws-1 has no processes/ subdirectory

        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        expect(result).toEqual({
            migrated: false, workspaceCount: 0, processCount: 0, turnCount: 0, errors: [],
        });
    });

    it('is a no-op when workspace has only processes.migrated/ (already migrated)', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const p1 = makeProcess('proc-1', 'ws-1');
        writeJSON(path.join(reposDir, 'ws-1', 'processes.migrated', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, 'ws-1', 'processes.migrated', 'proc-1.json'), p1.stored);

        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        expect(result).toEqual({
            migrated: false, workspaceCount: 0, processCount: 0, turnCount: 0, errors: [],
        });
    });

    // ========================================================================
    // Happy paths
    // ========================================================================

    it('migrates a single workspace with active processes', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-abc';
        await store.registerWorkspace({ id: wsId, name: 'My Project', rootPath: '/tmp/proj' });

        const p1 = makeProcess('proc-1', wsId, { turns: [makeTurn(0), makeTurn(1)] });
        const p2 = makeProcess('proc-2', wsId);
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index, p2.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-2.json'), p2.stored);

        const result = await migrateProcessHistoryIfNeeded(dataDir, store);

        expect(result.migrated).toBe(true);
        expect(result.workspaceCount).toBe(1);
        expect(result.processCount).toBe(2);
        expect(result.turnCount).toBe(2);
        expect(result.errors).toHaveLength(0);

        // Verify DB
        const db = new Database(path.join(dataDir, 'processes.db'));
        const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
        expect(count).toBe(2);
        const turnCount = (db.prepare('SELECT COUNT(*) AS cnt FROM conversation_turns').get() as { cnt: number }).cnt;
        expect(turnCount).toBe(2);
        db.close();
    });

    it('migrates multiple workspaces', async () => {
        const reposDir = path.join(dataDir, 'repos');

        await store.registerWorkspace({ id: 'ws-1', name: 'Project 1', rootPath: '/tmp/p1' });
        await store.registerWorkspace({ id: 'ws-2', name: 'Project 2', rootPath: '/tmp/p2' });

        const p1 = makeProcess('proc-1', 'ws-1');
        const p2 = makeProcess('proc-2', 'ws-2');

        writeJSON(path.join(reposDir, 'ws-1', 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, 'ws-1', 'processes', 'proc-1.json'), p1.stored);
        writeJSON(path.join(reposDir, 'ws-2', 'processes', 'index.json'), [p2.index]);
        writeJSON(path.join(reposDir, 'ws-2', 'processes', 'proc-2.json'), p2.stored);

        const result = await migrateProcessHistoryIfNeeded(dataDir, store);

        expect(result.migrated).toBe(true);
        expect(result.workspaceCount).toBe(2);
        expect(result.processCount).toBe(2);
    });

    it('migrates pruned/archived processes with archived=1', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-arch';
        await store.registerWorkspace({ id: wsId, name: 'Archived WS', rootPath: '/tmp' });

        const p1 = makeProcess('proc-active', wsId, { turns: [makeTurn(0)] });
        const p2 = makeProcess('proc-old', wsId);

        // Active
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-active.json'), p1.stored);

        // Archived
        writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2024-01', 'index.json'), [p2.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2024-01', 'proc-old.json'), p2.stored);

        const result = await migrateProcessHistoryIfNeeded(dataDir, store);

        expect(result.processCount).toBe(2);
        expect(result.turnCount).toBe(1);

        // Verify archived flag
        const db = new Database(path.join(dataDir, 'processes.db'));
        const activeRow = db.prepare('SELECT archived FROM processes WHERE id = ?').get('proc-active') as { archived: number };
        expect(activeRow.archived).toBe(0);
        const archivedRow = db.prepare('SELECT archived FROM processes WHERE id = ?').get('proc-old') as { archived: number };
        expect(archivedRow.archived).toBe(1);
        db.close();
    });

    it('migrates pruned processes from multiple month buckets', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-multi-bucket';
        await store.registerWorkspace({ id: wsId, name: 'Multi Bucket', rootPath: '/tmp' });

        const p1 = makeProcess('proc-jan', wsId);
        const p2 = makeProcess('proc-feb', wsId);

        // Empty active index
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), []);

        // Two pruned buckets
        writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2024-01', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2024-01', 'proc-jan.json'), p1.stored);
        writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2024-02', 'index.json'), [p2.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2024-02', 'proc-feb.json'), p2.stored);

        const result = await migrateProcessHistoryIfNeeded(dataDir, store);

        expect(result.processCount).toBe(2);

        const db = new Database(path.join(dataDir, 'processes.db'));
        const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes WHERE archived = 1').get() as { cnt: number }).cnt;
        expect(count).toBe(2);
        db.close();
    });

    // ========================================================================
    // Directory rename
    // ========================================================================

    it('renames processes/ to processes.migrated/ after successful migration', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-rename';
        await store.registerWorkspace({ id: wsId, name: 'Rename Test', rootPath: '/tmp' });

        const p1 = makeProcess('proc-1', wsId);
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);

        await migrateProcessHistoryIfNeeded(dataDir, store);

        expect(fs.existsSync(path.join(reposDir, wsId, 'processes'))).toBe(false);
        expect(fs.existsSync(path.join(reposDir, wsId, 'processes.migrated'))).toBe(true);
        expect(fs.existsSync(path.join(reposDir, wsId, 'processes.migrated', 'index.json'))).toBe(true);
    });

    // ========================================================================
    // Idempotency
    // ========================================================================

    it('is idempotent — second run is a no-op due to rename', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-idem';
        await store.registerWorkspace({ id: wsId, name: 'Idempotent', rootPath: '/tmp' });

        const p1 = makeProcess('proc-1', wsId);
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);

        // First run
        const result1 = await migrateProcessHistoryIfNeeded(dataDir, store);
        expect(result1.migrated).toBe(true);
        expect(result1.processCount).toBe(1);

        // Second run — processes/ no longer exists (renamed)
        const result2 = await migrateProcessHistoryIfNeeded(dataDir, store);
        expect(result2.migrated).toBe(false);

        // DB still has exactly 1 process
        const db = new Database(path.join(dataDir, 'processes.db'));
        const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
        expect(count).toBe(1);
        db.close();
    });

    it('handles re-run when rename failed (INSERT OR IGNORE skips duplicates)', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-rerun';
        await store.registerWorkspace({ id: wsId, name: 'Rerun', rootPath: '/tmp' });

        const p1 = makeProcess('proc-1', wsId, { turns: [makeTurn(0)] });
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);

        // First run
        await migrateProcessHistoryIfNeeded(dataDir, store);

        // Simulate rename failure by restoring the directory
        fs.renameSync(
            path.join(reposDir, wsId, 'processes.migrated'),
            path.join(reposDir, wsId, 'processes'),
        );

        // Second run — should skip the already-imported process
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        expect(result.migrated).toBe(true);
        expect(result.processCount).toBe(0); // 0 newly imported (skipped via INSERT OR IGNORE)

        // DB still has exactly 1 process
        const db = new Database(path.join(dataDir, 'processes.db'));
        const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
        expect(count).toBe(1);
        db.close();
    });

    // ========================================================================
    // Partial failures
    // ========================================================================

    it('continues to next workspace when one has corrupted data', async () => {
        const reposDir = path.join(dataDir, 'repos');

        await store.registerWorkspace({ id: 'ws-good', name: 'Good', rootPath: '/tmp/good' });
        await store.registerWorkspace({ id: 'ws-bad', name: 'Bad', rootPath: '/tmp/bad' });

        // Good workspace
        const p1 = makeProcess('proc-good', 'ws-good');
        writeJSON(path.join(reposDir, 'ws-good', 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, 'ws-good', 'processes', 'proc-good.json'), p1.stored);

        // Bad workspace — corrupt index.json
        fs.mkdirSync(path.join(reposDir, 'ws-bad', 'processes'), { recursive: true });
        fs.writeFileSync(path.join(reposDir, 'ws-bad', 'processes', 'index.json'), 'not valid json');

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        stderrSpy.mockRestore();

        // Good workspace migrated successfully
        expect(result.processCount).toBe(1);
        // Both workspaces counted (bad one had 0 processes but still processed)
        expect(result.workspaceCount).toBe(2);

        const db = new Database(path.join(dataDir, 'processes.db'));
        const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
        expect(count).toBe(1);
        db.close();
    });

    it('skips individual malformed process files and continues', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-mixed';
        await store.registerWorkspace({ id: wsId, name: 'Mixed', rootPath: '/tmp' });

        const good = makeProcess('proc-good', wsId);
        const badIndex: ProcessIndexEntry = {
            id: 'proc-bad', workspaceId: wsId, status: 'completed',
            type: 'clarification', startTime: '2024-01-01T00:00:00Z',
            promptPreview: 'bad',
        };

        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [good.index, badIndex]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-good.json'), good.stored);
        fs.writeFileSync(path.join(reposDir, wsId, 'processes', 'proc-bad.json'), '{ not valid }}}');

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        stderrSpy.mockRestore();

        expect(result.processCount).toBe(1);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('proc-bad'))).toBe(true);
    });

    it('skips missing process files referenced by index', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-missing';
        await store.registerWorkspace({ id: wsId, name: 'Missing', rootPath: '/tmp' });

        const p1 = makeProcess('proc-exists', wsId);
        const missingIndex: ProcessIndexEntry = {
            id: 'proc-missing', workspaceId: wsId, status: 'completed',
            type: 'clarification', startTime: '2024-01-01T00:00:00Z',
            promptPreview: 'missing',
        };

        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index, missingIndex]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-exists.json'), p1.stored);
        // proc-missing.json intentionally not created

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        stderrSpy.mockRestore();

        expect(result.processCount).toBe(1);
        expect(result.errors.some(e => e.includes('proc-missing'))).toBe(true);
    });

    // ========================================================================
    // Workspace auto-registration
    // ========================================================================

    it('auto-registers unregistered workspace directories', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-unregistered';
        // NOT calling store.registerWorkspace() — should auto-register

        const p1 = makeProcess('proc-1', wsId);
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);

        expect(result.processCount).toBe(1);

        // Verify workspace was auto-registered
        const workspaces = await store.getWorkspaces();
        expect(workspaces.some(ws => ws.id === wsId)).toBe(true);

        // Verify log mentions auto-registration
        const messages = stderrSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('Auto-registered'))).toBe(true);
        stderrSpy.mockRestore();
    });

    // ========================================================================
    // Empty processes directory
    // ========================================================================

    it('handles empty processes directory (empty index.json) and still renames', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-empty';
        await store.registerWorkspace({ id: wsId, name: 'Empty', rootPath: '/tmp' });

        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), []);

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        stderrSpy.mockRestore();

        expect(result.migrated).toBe(true);
        expect(result.processCount).toBe(0);
        // Directory should still be renamed
        expect(fs.existsSync(path.join(reposDir, wsId, 'processes'))).toBe(false);
        expect(fs.existsSync(path.join(reposDir, wsId, 'processes.migrated'))).toBe(true);
    });

    it('handles processes dir with no index.json and still renames', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-no-index';
        await store.registerWorkspace({ id: wsId, name: 'No Index', rootPath: '/tmp' });

        fs.mkdirSync(path.join(reposDir, wsId, 'processes'), { recursive: true });
        // No index.json at all

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const result = await migrateProcessHistoryIfNeeded(dataDir, store);
        stderrSpy.mockRestore();

        expect(result.migrated).toBe(true);
        expect(result.processCount).toBe(0);
        expect(fs.existsSync(path.join(reposDir, wsId, 'processes'))).toBe(false);
        expect(fs.existsSync(path.join(reposDir, wsId, 'processes.migrated'))).toBe(true);
    });

    // ========================================================================
    // Logging
    // ========================================================================

    it('logs migration progress to stderr with [ProcessMigration] prefix', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-log';
        await store.registerWorkspace({ id: wsId, name: 'Log Test', rootPath: '/tmp' });

        const p1 = makeProcess('proc-1', wsId, { turns: [makeTurn(0)] });
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        await migrateProcessHistoryIfNeeded(dataDir, store);

        const messages = stderrSpy.mock.calls.map(c => String(c[0]));
        expect(messages.every(m => m.includes('[ProcessMigration]'))).toBe(true);
        expect(messages.some(m => m.includes('1 workspace'))).toBe(true);
        expect(messages.some(m => m.includes('1 process'))).toBe(true);
        expect(messages.some(m => m.includes('Migration complete'))).toBe(true);
        stderrSpy.mockRestore();
    });

    it('does not log when migration is a no-op', async () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        await migrateProcessHistoryIfNeeded(dataDir, store);

        expect(stderrSpy.mock.calls).toHaveLength(0);
        stderrSpy.mockRestore();
    });

    // ========================================================================
    // Data integrity
    // ========================================================================

    it('preserves conversation turn content and metadata', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-integrity';
        await store.registerWorkspace({ id: wsId, name: 'Integrity', rootPath: '/tmp' });

        const turns: SerializedConversationTurn[] = [
            {
                turnIndex: 0,
                role: 'user',
                content: 'Hello, how are you?',
                timestamp: '2024-01-15T10:00:00.000Z',
                streaming: false,
                timeline: [{ type: 'start', timestamp: '2024-01-15T10:00:00.000Z' }],
                toolCalls: [{
                    id: 'tc1', name: 'readFile', status: 'completed',
                    startTime: '2024-01-15T10:00:01.000Z',
                    endTime: '2024-01-15T10:00:02.000Z',
                    args: { path: '/test.ts' },
                    result: 'content',
                }],
            },
            {
                turnIndex: 1,
                role: 'assistant',
                content: 'I am fine, thank you!',
                timestamp: '2024-01-15T10:01:00.000Z',
                streaming: false,
                timeline: [],
            },
        ];

        const p1 = makeProcess('proc-1', wsId, { turns });
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        await migrateProcessHistoryIfNeeded(dataDir, store);
        stderrSpy.mockRestore();

        const db = new Database(path.join(dataDir, 'processes.db'));
        const dbTurns = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index').all('proc-1') as Array<Record<string, unknown>>;
        expect(dbTurns).toHaveLength(2);
        expect(dbTurns[0].content).toBe('Hello, how are you?');
        expect(dbTurns[0].role).toBe('user');
        expect(dbTurns[1].content).toBe('I am fine, thank you!');
        expect(dbTurns[1].role).toBe('assistant');

        // Verify tool calls are serialized
        const toolCalls = JSON.parse(dbTurns[0].tool_calls as string);
        expect(toolCalls[0].name).toBe('readFile');
        db.close();
    });

    it('does not interfere with other files in workspace directory', async () => {
        const reposDir = path.join(dataDir, 'repos');
        const wsId = 'ws-other-files';
        await store.registerWorkspace({ id: wsId, name: 'Other Files', rootPath: '/tmp' });

        const p1 = makeProcess('proc-1', wsId);
        writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), [p1.index]);
        writeJSON(path.join(reposDir, wsId, 'processes', 'proc-1.json'), p1.stored);
        writeJSON(path.join(reposDir, wsId, 'queues.json'), { pending: [] });
        fs.mkdirSync(path.join(reposDir, wsId, 'tasks'), { recursive: true });
        fs.writeFileSync(path.join(reposDir, wsId, 'tasks', 'task.md'), '# Task');

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        await migrateProcessHistoryIfNeeded(dataDir, store);
        stderrSpy.mockRestore();

        // Other files should be untouched
        expect(fs.existsSync(path.join(reposDir, wsId, 'queues.json'))).toBe(true);
        expect(fs.existsSync(path.join(reposDir, wsId, 'tasks', 'task.md'))).toBe(true);
    });
});
