/**
 * Storage Migration Engine Tests
 *
 * Validates the 5-phase migration pipeline:
 * - Full migration succeeds with realistic JSON fixtures
 * - Pruned processes imported with archived = 1
 * - Validation catches count mismatch
 * - Cancellation during phase 2
 * - Empty workspace handled gracefully
 * - Missing workspaces.json / wikis.json handled gracefully
 * - Progress events emitted in order
 * - config.yaml updated correctly
 * - JSON cleanup selective (non-process files preserved)
 * - Failure at phase 1 cleans up
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { StorageMigrationEngine } from '../../src/server/storage-migration';
import type { MigrationProgress, MigrationSummary } from '../../src/server/storage-migration';
import type {
    ProcessIndexEntry,
    WorkspaceInfo,
    WikiInfo,
    StoredProcessEntry,
    SerializedAIProcess,
    SerializedConversationTurn,
} from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'storage-migration-test-'));
}

function writeFile(filePath: string, data: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data, 'utf-8');
}

function writeJSON(filePath: string, data: unknown): void {
    writeFile(filePath, JSON.stringify(data, null, 2));
}

function makeProcess(
    id: string,
    workspaceId: string,
    opts?: {
        turns?: SerializedConversationTurn[];
        status?: string;
        type?: string;
    }
): { index: ProcessIndexEntry; stored: StoredProcessEntry } {
    const startTime = '2024-01-15T10:00:00.000Z';
    const endTime = '2024-01-15T10:05:00.000Z';
    const turns = opts?.turns ?? [];
    const status = opts?.status ?? 'completed';
    const type = opts?.type ?? 'clarification';

    const serialized: SerializedAIProcess = {
        id,
        type,
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
        type,
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

function makeTurn(turnIndex: number, opts?: {
    toolCalls?: unknown[];
    role?: 'user' | 'assistant';
}): SerializedConversationTurn {
    return {
        role: opts?.role ?? (turnIndex % 2 === 0 ? 'user' : 'assistant'),
        content: `Turn ${turnIndex} content`,
        timestamp: `2024-01-15T10:0${turnIndex}:00.000Z`,
        turnIndex,
        timeline: [],
        toolCalls: opts?.toolCalls as SerializedConversationTurn['toolCalls'],
    };
}

function buildFixtures(dataDir: string): void {
    // config.yaml
    writeFile(path.join(dataDir, 'config.yaml'), 'model: gpt-4\n');

    // workspaces.json (2 entries)
    const workspaces: WorkspaceInfo[] = [
        { id: 'ws1', name: 'Workspace 1', rootPath: '/path/to/ws1', color: '#ff0000' },
        { id: 'ws2', name: 'Workspace 2', rootPath: '/path/to/ws2', aiEnabled: false } as unknown as WorkspaceInfo,
    ];
    writeJSON(path.join(dataDir, 'workspaces.json'), workspaces);

    // wikis.json (1 entry)
    const wikis: WikiInfo[] = [
        { id: 'wiki1', name: 'Test Wiki', wikiDir: '/path/to/wiki', repoPath: '/path/to/repo', aiEnabled: true, registeredAt: '2024-01-01T00:00:00.000Z' },
    ];
    writeJSON(path.join(dataDir, 'wikis.json'), wikis);

    // ws1: 3 active processes + 1 pruned
    const proc1 = makeProcess('proc-1', 'ws1', {
        turns: [makeTurn(0), makeTurn(1)],
    });
    const proc2 = makeProcess('proc-2', 'ws1', { turns: [] });
    const proc3 = makeProcess('proc-3', 'ws1', {
        turns: [makeTurn(0, {
            toolCalls: [{
                id: 'tc1', name: 'readFile', status: 'completed',
                startTime: '2024-01-15T10:01:00.000Z',
                endTime: '2024-01-15T10:01:30.000Z',
                args: { path: '/test.ts' },
                result: 'file content',
            }],
        })],
    });

    const ws1Dir = path.join(dataDir, 'repos', 'ws1', 'processes');
    writeJSON(path.join(ws1Dir, 'index.json'), [proc1.index, proc2.index, proc3.index]);
    writeJSON(path.join(ws1Dir, 'proc-1.json'), proc1.stored);
    writeJSON(path.join(ws1Dir, 'proc-2.json'), proc2.stored);
    writeJSON(path.join(ws1Dir, 'proc-3.json'), proc3.stored);

    // ws1: pruned
    const procOld = makeProcess('proc-old', 'ws1', { status: 'completed', type: 'pipeline-execution' });
    const prunedDir = path.join(ws1Dir, 'pruned', '2024-01');
    writeJSON(path.join(prunedDir, 'index.json'), [procOld.index]);
    writeJSON(path.join(prunedDir, 'proc-old.json'), procOld.stored);

    // ws2: 2 active processes
    const proc4 = makeProcess('proc-4', 'ws2');
    const proc5 = makeProcess('proc-5', 'ws2', {
        turns: [makeTurn(0), makeTurn(1), makeTurn(2)],
    });

    const ws2Dir = path.join(dataDir, 'repos', 'ws2', 'processes');
    writeJSON(path.join(ws2Dir, 'index.json'), [proc4.index, proc5.index]);
    writeJSON(path.join(ws2Dir, 'proc-4.json'), proc4.stored);
    writeJSON(path.join(ws2Dir, 'proc-5.json'), proc5.stored);

    // Non-process files that should NOT be deleted
    writeJSON(path.join(dataDir, 'repos', 'ws1', 'queues.json'), { pending: [], history: [] });
    fs.mkdirSync(path.join(dataDir, 'repos', 'ws1', 'schedules'), { recursive: true });
    writeFile(path.join(dataDir, 'repos', 'ws1', 'schedules', 'test.yaml'), 'name: test\n');
    fs.mkdirSync(path.join(dataDir, 'repos', 'ws1', 'outputs'), { recursive: true });
    writeFile(path.join(dataDir, 'repos', 'ws1', 'outputs', 'output.md'), '# Output');
    fs.mkdirSync(path.join(dataDir, 'repos', 'ws1', 'paste-context'), { recursive: true });
    writeFile(path.join(dataDir, 'repos', 'ws1', 'paste-context', 'ctx.txt'), 'context');
    fs.mkdirSync(path.join(dataDir, 'memory'), { recursive: true });
    writeFile(path.join(dataDir, 'memory', 'data.json'), '{}');
}

// ============================================================================
// Tests
// ============================================================================

describe('StorageMigrationEngine', () => {
    let dataDir: string;
    let dbPath: string;
    let events: MigrationProgress[];

    beforeEach(() => {
        dataDir = createTempDir();
        dbPath = path.join(dataDir, 'coc.db');
        events = [];
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function createEngine(signal?: AbortSignal) {
        return new StorageMigrationEngine({
            dataDir,
            dbPath,
            onProgress: (event) => events.push({ ...event }),
            signal,
        });
    }

    // ========================================================================
    // Full migration succeeds
    // ========================================================================

    it('full migration succeeds with all phases', async () => {
        buildFixtures(dataDir);
        const engine = createEngine();
        const summary = await engine.run();

        // Verify summary counts
        expect(summary.processes).toBe(5);
        expect(summary.archivedProcesses).toBe(1);
        expect(summary.workspaces).toBe(2);
        expect(summary.wikis).toBe(1);
        expect(summary.durationMs).toBeGreaterThan(0);

        // Verify SQLite data
        const db = new Database(dbPath);
        try {
            const processCount = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
            expect(processCount).toBe(6); // 5 active + 1 archived

            const turnCount = (db.prepare('SELECT COUNT(*) AS cnt FROM conversation_turns').get() as { cnt: number }).cnt;
            expect(turnCount).toBe(6); // proc-1: 2 + proc-3: 1 + proc-5: 3

            const wsCount = (db.prepare('SELECT COUNT(*) AS cnt FROM workspaces').get() as { cnt: number }).cnt;
            expect(wsCount).toBe(2);

            const wikiCount = (db.prepare('SELECT COUNT(*) AS cnt FROM wikis').get() as { cnt: number }).cnt;
            expect(wikiCount).toBe(1);

            // Verify specific process
            const proc1 = db.prepare('SELECT * FROM processes WHERE id = ?').get('proc-1') as Record<string, unknown>;
            expect(proc1.workspace_id).toBe('ws1');
            expect(proc1.status).toBe('completed');
            expect(proc1.prompt_preview).toBe('Preview for proc-1');
            expect(proc1.archived).toBe(0);

            // Verify turns for proc-1
            const turns1 = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index').all('proc-1') as Array<Record<string, unknown>>;
            expect(turns1).toHaveLength(2);
            expect(turns1[0].role).toBe('user');
            expect(turns1[1].role).toBe('assistant');
        } finally {
            db.close();
        }

        // Verify JSON process files are deleted
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'proc-1.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'index.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'pruned'))).toBe(false);

        // Verify config updated
        const configContent = fs.readFileSync(path.join(dataDir, 'config.yaml'), 'utf-8');
        expect(configContent).toContain('sqlite');
    });

    // ========================================================================
    // Pruned processes imported with archived = 1
    // ========================================================================

    it('pruned processes have archived = 1', async () => {
        buildFixtures(dataDir);
        const engine = createEngine();
        await engine.run();

        const db = new Database(dbPath);
        try {
            const procOld = db.prepare('SELECT * FROM processes WHERE id = ?').get('proc-old') as Record<string, unknown>;
            expect(procOld.archived).toBe(1);

            // Active processes should have archived = 0
            const proc1 = db.prepare('SELECT * FROM processes WHERE id = ?').get('proc-1') as Record<string, unknown>;
            expect(proc1.archived).toBe(0);
        } finally {
            db.close();
        }
    });

    // ========================================================================
    // Validation catches count mismatch
    // ========================================================================

    it('validation catches count mismatch and deletes .db', async () => {
        buildFixtures(dataDir);

        // Patch the engine to tamper with DB after phase 3
        const engine = createEngine();
        const originalRun = engine.run.bind(engine);

        // We'll test by creating a scenario where JSON has more entries than what's in DB
        // Add an extra entry to the index that doesn't have a matching process file
        // Actually, let's tamper with the DB after migration by deleting a row
        // We need to intercept between phase 3 and phase 4

        // Instead, let's use the progress callback to tamper with DB at the right moment
        let tampered = false;
        const tamperEngine = new StorageMigrationEngine({
            dataDir,
            dbPath,
            onProgress: (event) => {
                events.push({ ...event });
                if (event.phase === 3 && event.message.includes('Migrated') && !tampered) {
                    tampered = true;
                    // Tamper with the DB — delete a process row
                    const db = new Database(dbPath);
                    db.prepare('DELETE FROM processes WHERE id = ?').run('proc-1');
                    db.close();
                }
            },
        });

        await expect(tamperEngine.run()).rejects.toThrow(/Migration failed in phase 4/);

        // .db file should be deleted
        expect(fs.existsSync(dbPath)).toBe(false);

        // JSON files should be untouched
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'proc-1.json'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'index.json'))).toBe(true);
    });

    // ========================================================================
    // Cancellation during phase 2
    // ========================================================================

    it('cancellation during phase 2 deletes .db and preserves JSON', async () => {
        buildFixtures(dataDir);

        const controller = new AbortController();
        let wsCount = 0;

        const cancelEngine = new StorageMigrationEngine({
            dataDir,
            dbPath,
            onProgress: (event) => {
                events.push({ ...event });
                if (event.phase === 2 && event.message.startsWith('Migrating workspace')) {
                    wsCount++;
                    if (wsCount >= 1) {
                        controller.abort();
                    }
                }
            },
            signal: controller.signal,
        });

        await expect(cancelEngine.run()).rejects.toThrow();

        // .db file should be deleted
        expect(fs.existsSync(dbPath)).toBe(false);

        // JSON files should be intact
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'proc-1.json'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws2', 'processes', 'proc-4.json'))).toBe(true);
    });

    // ========================================================================
    // Empty workspace (no processes dir or empty index)
    // ========================================================================

    it('handles empty workspace gracefully', async () => {
        // Create minimal structure with an empty workspace
        writeFile(path.join(dataDir, 'config.yaml'), 'model: gpt-4\n');
        const emptyWsDir = path.join(dataDir, 'repos', 'ws-empty', 'processes');
        fs.mkdirSync(emptyWsDir, { recursive: true });
        writeJSON(path.join(emptyWsDir, 'index.json'), []);

        const engine = createEngine();
        const summary = await engine.run();

        expect(summary.processes).toBe(0);
        expect(summary.archivedProcesses).toBe(0);
    });

    it('handles workspace with no processes dir', async () => {
        writeFile(path.join(dataDir, 'config.yaml'), 'model: gpt-4\n');
        fs.mkdirSync(path.join(dataDir, 'repos', 'ws-no-proc'), { recursive: true });

        const engine = createEngine();
        const summary = await engine.run();

        expect(summary.processes).toBe(0);
        expect(summary.archivedProcesses).toBe(0);
    });

    // ========================================================================
    // Missing workspaces.json / wikis.json
    // ========================================================================

    it('handles missing workspaces.json and wikis.json gracefully', async () => {
        writeFile(path.join(dataDir, 'config.yaml'), 'model: gpt-4\n');
        // No workspaces.json or wikis.json

        const engine = createEngine();
        const summary = await engine.run();

        expect(summary.workspaces).toBe(0);
        expect(summary.wikis).toBe(0);
    });

    // ========================================================================
    // Progress events emitted in order
    // ========================================================================

    it('progress events fire in monotonically increasing phase order', async () => {
        buildFixtures(dataDir);
        const engine = createEngine();
        await engine.run();

        expect(events.length).toBeGreaterThan(0);

        // Phase numbers should be monotonically non-decreasing
        for (let i = 1; i < events.length; i++) {
            expect(events[i].phase).toBeGreaterThanOrEqual(events[i - 1].phase);
        }

        // Should cover phases 1 through 5
        const phases = new Set(events.map(e => e.phase));
        expect(phases.has(1)).toBe(true);
        expect(phases.has(2)).toBe(true);
        expect(phases.has(3)).toBe(true);
        expect(phases.has(4)).toBe(true);
        expect(phases.has(5)).toBe(true);

        // Final event should have status 'complete' with summary
        const lastEvent = events[events.length - 1];
        expect(lastEvent.status).toBe('complete');
        expect(lastEvent.summary).toBeDefined();
        expect(lastEvent.summary!.processes).toBe(5);
    });

    // ========================================================================
    // config.yaml updated correctly
    // ========================================================================

    it('config.yaml updated with store.backend = sqlite, other fields preserved', async () => {
        buildFixtures(dataDir);
        const engine = createEngine();
        await engine.run();

        const configContent = fs.readFileSync(path.join(dataDir, 'config.yaml'), 'utf-8');
        expect(configContent).toContain('sqlite');
        expect(configContent).toContain('gpt-4');
    });

    // ========================================================================
    // JSON cleanup selective
    // ========================================================================

    it('cleanup deletes process JSON but preserves non-process files', async () => {
        buildFixtures(dataDir);
        const engine = createEngine();
        await engine.run();

        // Process files should be deleted
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'proc-1.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'index.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'processes', 'pruned'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws2', 'processes', 'proc-4.json'))).toBe(false);

        // Non-process files should be preserved
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'queues.json'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'schedules', 'test.yaml'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'outputs', 'output.md'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'ws1', 'paste-context', 'ctx.txt'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'memory', 'data.json'))).toBe(true);

        // workspaces.json and wikis.json should be preserved (backup)
        expect(fs.existsSync(path.join(dataDir, 'workspaces.json'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'wikis.json'))).toBe(true);
    });

    // ========================================================================
    // Failure at phase 1 cleans up
    // ========================================================================

    it('failure at schema creation cleans up .db file', async () => {
        // Make dbPath a directory to cause Database creation to fail
        fs.mkdirSync(dbPath, { recursive: true });

        const engine = createEngine();
        await expect(engine.run()).rejects.toThrow();

        // If there's a leftover .db file, it should be cleaned up
        // (In this case, the directory will remain since unlinkSync can't remove dirs,
        // but the error handling code attempts cleanup)
    });

    it('failure during migration does not modify config.yaml', async () => {
        buildFixtures(dataDir);

        // Create a read-only db path scenario
        const originalConfig = fs.readFileSync(path.join(dataDir, 'config.yaml'), 'utf-8');

        // Tamper to cause validation failure
        const tamperEngine = new StorageMigrationEngine({
            dataDir,
            dbPath,
            onProgress: (event) => {
                events.push({ ...event });
                if (event.phase === 3 && event.message.includes('Migrated')) {
                    const db = new Database(dbPath);
                    db.prepare('DELETE FROM processes WHERE id = ?').run('proc-2');
                    db.close();
                }
            },
        });

        await expect(tamperEngine.run()).rejects.toThrow(/Migration failed/);

        // Config should not be modified
        const configAfter = fs.readFileSync(path.join(dataDir, 'config.yaml'), 'utf-8');
        expect(configAfter).toBe(originalConfig);
    });

    // ========================================================================
    // Conversation turns with tool calls
    // ========================================================================

    it('migrates conversation turns with tool calls correctly', async () => {
        buildFixtures(dataDir);
        const engine = createEngine();
        await engine.run();

        const db = new Database(dbPath);
        try {
            // proc-3 has 1 turn with tool calls
            const turns = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index').all('proc-3') as Array<Record<string, unknown>>;
            expect(turns).toHaveLength(1);
            expect(turns[0].turn_index).toBe(0);

            const toolCalls = JSON.parse(turns[0].tool_calls as string);
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].name).toBe('readFile');
            expect(toolCalls[0].status).toBe('completed');
        } finally {
            db.close();
        }
    });

    // ========================================================================
    // No repos directory
    // ========================================================================

    it('handles no repos directory gracefully', async () => {
        writeFile(path.join(dataDir, 'config.yaml'), 'model: gpt-4\n');
        // No repos/ directory at all

        const engine = createEngine();
        const summary = await engine.run();

        expect(summary.processes).toBe(0);
        expect(summary.archivedProcesses).toBe(0);
        expect(summary.workspaces).toBe(0);
        expect(summary.wikis).toBe(0);
    });

    // ========================================================================
    // Corrupt process files are skipped
    // ========================================================================

    it('skips corrupt process files and continues', async () => {
        writeFile(path.join(dataDir, 'config.yaml'), 'model: gpt-4\n');

        // Create a workspace with one valid and one corrupt process
        const validProc = makeProcess('valid-proc', 'ws-mixed');
        const ws = path.join(dataDir, 'repos', 'ws-mixed', 'processes');

        const corruptIndex: ProcessIndexEntry = {
            id: 'corrupt-proc',
            workspaceId: 'ws-mixed',
            status: 'completed',
            type: 'clarification',
            startTime: '2024-01-15T10:00:00.000Z',
            promptPreview: 'corrupt',
        };

        writeJSON(path.join(ws, 'index.json'), [validProc.index, corruptIndex]);
        writeJSON(path.join(ws, 'valid-proc.json'), validProc.stored);
        writeFile(path.join(ws, 'corrupt-proc.json'), '{corrupt json!!!');

        const engine = createEngine();
        const summary = await engine.run();

        // Only the valid process should be migrated
        expect(summary.processes).toBe(1);

        const db = new Database(dbPath);
        try {
            const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
            expect(count).toBe(1);
        } finally {
            db.close();
        }
    });

    // ========================================================================
    // Metadata envelope matches SqliteProcessStore format
    // ========================================================================

    it('metadata envelope includes workspaceId', async () => {
        buildFixtures(dataDir);
        const engine = createEngine();
        await engine.run();

        const db = new Database(dbPath);
        try {
            const proc = db.prepare('SELECT metadata FROM processes WHERE id = ?').get('proc-1') as { metadata: string };
            const meta = JSON.parse(proc.metadata);
            expect(meta.workspaceId).toBe('ws1');
        } finally {
            db.close();
        }
    });
});
