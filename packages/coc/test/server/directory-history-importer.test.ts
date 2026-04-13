/**
 * Directory History Importer Tests
 *
 * Validates the scan, match, and import pipeline:
 * - Scan a directory with multiple workspace subdirectories
 * - Scan with auto-detect (repos/ subdirectory inside given path)
 * - Match scanned workspaces against registered workspaces
 * - Import processes into SQLite with correct row counts
 * - Duplicate process IDs are skipped (not errored)
 * - Archived processes from pruned/YYYY-MM/ buckets imported with archived=1
 * - Corrupt JSON files are skipped with warning, not fatal
 * - Empty directory → zero results (no error)
 * - Non-existent directory → clear error message
 * - Directory without processes/ subfolder → skipped gracefully
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import type {
    ProcessIndexEntry,
    StoredProcessEntry,
    SerializedAIProcess,
    SerializedConversationTurn,
    WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import { DirectoryHistoryImporter } from '../../src/server/directory-history-importer';
import type { ImportProgress } from '../../src/server/directory-history-importer';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dir-import-test-'));
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

function createDb(dir: string): string {
    const dbPath = path.join(dir, 'processes.db');
    const db = new Database(dbPath);
    initializeDatabase(db);
    db.close();
    return dbPath;
}

function buildFixtures(reposDir: string): void {
    // Workspace 1: 2 active processes + 1 archived
    const ws1 = 'ws-abc123';
    const p1 = makeProcess('proc-1', ws1, { turns: [makeTurn(0), makeTurn(1)] });
    const p2 = makeProcess('proc-2', ws1);
    const p3 = makeProcess('proc-old', ws1, { status: 'completed' });

    writeJSON(path.join(reposDir, ws1, 'processes', 'index.json'), [p1.index, p2.index]);
    writeJSON(path.join(reposDir, ws1, 'processes', 'proc-1.json'), p1.stored);
    writeJSON(path.join(reposDir, ws1, 'processes', 'proc-2.json'), p2.stored);

    writeJSON(path.join(reposDir, ws1, 'processes', 'pruned', '2024-01', 'index.json'), [p3.index]);
    writeJSON(path.join(reposDir, ws1, 'processes', 'pruned', '2024-01', 'proc-old.json'), p3.stored);

    // Workspace 2: 1 active process
    const ws2 = 'ws-def456';
    const p4 = makeProcess('proc-4', ws2);

    writeJSON(path.join(reposDir, ws2, 'processes', 'index.json'), [p4.index]);
    writeJSON(path.join(reposDir, ws2, 'processes', 'proc-4.json'), p4.stored);
}

const REGISTERED_WORKSPACES: WorkspaceInfo[] = [
    { id: 'ws-abc123', name: 'My Project', rootPath: '/home/user/my-project' },
    { id: 'ws-def456', name: 'Another Project', rootPath: '/home/user/another' },
];

// ============================================================================
// Tests
// ============================================================================

describe('DirectoryHistoryImporter', () => {
    let tempDir: string;
    let importer: DirectoryHistoryImporter;

    beforeEach(() => {
        tempDir = createTempDir();
        importer = new DirectoryHistoryImporter();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // ========================================================================
    // scan()
    // ========================================================================

    describe('scan()', () => {
        it('should scan a repos directory with multiple workspaces', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);

            const result = importer.scan(reposDir);

            expect(result.reposDir).toBe(reposDir);
            expect(result.workspaces).toHaveLength(2);

            const ws1 = result.workspaces.find(w => w.workspaceId === 'ws-abc123');
            expect(ws1).toBeDefined();
            expect(ws1!.activeCount).toBe(2);
            expect(ws1!.archivedCount).toBe(1);
            expect(ws1!.archivedBuckets).toEqual(['2024-01']);

            const ws2 = result.workspaces.find(w => w.workspaceId === 'ws-def456');
            expect(ws2).toBeDefined();
            expect(ws2!.activeCount).toBe(1);
            expect(ws2!.archivedCount).toBe(0);
        });

        it('should auto-detect repos/ subdirectory', () => {
            const parentDir = tempDir;
            const reposDir = path.join(parentDir, 'repos');
            buildFixtures(reposDir);

            const result = importer.scan(parentDir);

            expect(result.reposDir).toBe(reposDir);
            expect(result.workspaces).toHaveLength(2);
        });

        it('should return empty results for an empty directory', () => {
            const emptyDir = path.join(tempDir, 'empty');
            fs.mkdirSync(emptyDir, { recursive: true });

            const result = importer.scan(emptyDir);

            expect(result.workspaces).toHaveLength(0);
        });

        it('should throw for a non-existent directory', () => {
            expect(() => importer.scan(path.join(tempDir, 'does-not-exist')))
                .toThrow('Directory does not exist');
        });

        it('should throw for a file path', () => {
            const filePath = path.join(tempDir, 'afile.txt');
            fs.writeFileSync(filePath, 'hello');

            expect(() => importer.scan(filePath))
                .toThrow('Path is not a directory');
        });

        it('should skip workspace directories without processes/ subfolder', () => {
            const reposDir = path.join(tempDir, 'repos');
            fs.mkdirSync(path.join(reposDir, 'ws-no-processes'), { recursive: true });
            fs.writeFileSync(path.join(reposDir, 'ws-no-processes', 'some-file.txt'), 'data');

            const result = importer.scan(reposDir);
            expect(result.workspaces).toHaveLength(0);
        });

        it('should skip workspaces with empty index.json', () => {
            const reposDir = path.join(tempDir, 'repos');
            writeJSON(path.join(reposDir, 'ws-empty', 'processes', 'index.json'), []);

            const result = importer.scan(reposDir);
            expect(result.workspaces).toHaveLength(0);
        });

        it('should handle corrupt index.json gracefully', () => {
            const reposDir = path.join(tempDir, 'repos');
            const processesDir = path.join(reposDir, 'ws-corrupt', 'processes');
            fs.mkdirSync(processesDir, { recursive: true });
            fs.writeFileSync(path.join(processesDir, 'index.json'), 'not valid json');

            const result = importer.scan(reposDir);
            expect(result.workspaces).toHaveLength(0);
        });
    });

    // ========================================================================
    // matchWorkspaces()
    // ========================================================================

    describe('matchWorkspaces()', () => {
        it('should match scanned workspaces against registered ones', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);
            const scanResult = importer.scan(reposDir);

            const matchResult = importer.matchWorkspaces(scanResult, REGISTERED_WORKSPACES);

            expect(matchResult.matched).toHaveLength(2);
            expect(matchResult.unmatched).toHaveLength(0);
            expect(matchResult.totalProcesses).toBe(4);
            expect(matchResult.totalMatchedProcesses).toBe(4);

            const m1 = matchResult.matched.find(m => m.workspaceId === 'ws-abc123');
            expect(m1!.registeredName).toBe('My Project');
        });

        it('should separate unmatched workspaces', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);
            const scanResult = importer.scan(reposDir);

            const partialWorkspaces: WorkspaceInfo[] = [
                { id: 'ws-abc123', name: 'My Project', rootPath: '/home/user/my-project' },
            ];

            const matchResult = importer.matchWorkspaces(scanResult, partialWorkspaces);

            expect(matchResult.matched).toHaveLength(1);
            expect(matchResult.unmatched).toHaveLength(1);
            expect(matchResult.unmatched[0].workspaceId).toBe('ws-def456');
            expect(matchResult.totalProcesses).toBe(4);
            expect(matchResult.totalMatchedProcesses).toBe(3);
        });

        it('should return all unmatched when no workspaces registered', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);
            const scanResult = importer.scan(reposDir);

            const matchResult = importer.matchWorkspaces(scanResult, []);

            expect(matchResult.matched).toHaveLength(0);
            expect(matchResult.unmatched).toHaveLength(2);
            expect(matchResult.totalMatchedProcesses).toBe(0);
        });
    });

    // ========================================================================
    // importProcesses()
    // ========================================================================

    describe('importProcesses()', () => {
        it('should import processes into SQLite', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);
            const dbPath = createDb(tempDir);

            const scanResult = importer.scan(reposDir);
            const matchResult = importer.matchWorkspaces(scanResult, REGISTERED_WORKSPACES);

            const summary = importer.importProcesses(matchResult, reposDir, dbPath);

            expect(summary.imported).toBe(4);
            expect(summary.skipped).toBe(0);
            expect(summary.failed).toBe(0);
            expect(summary.perWorkspace).toHaveLength(2);

            // Verify in DB
            const db = new Database(dbPath);
            const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
            expect(count).toBe(4);

            // Verify archived flag
            const archived = (db.prepare('SELECT COUNT(*) AS cnt FROM processes WHERE archived = 1').get() as { cnt: number }).cnt;
            expect(archived).toBe(1);

            // Verify conversation turns
            const turnCount = (db.prepare('SELECT COUNT(*) AS cnt FROM conversation_turns').get() as { cnt: number }).cnt;
            expect(turnCount).toBe(2);

            db.close();
        });

        it('should skip duplicate process IDs', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);
            const dbPath = createDb(tempDir);

            const scanResult = importer.scan(reposDir);
            const matchResult = importer.matchWorkspaces(scanResult, REGISTERED_WORKSPACES);

            // Import once
            importer.importProcesses(matchResult, reposDir, dbPath);

            // Import again — all should be skipped
            const summary2 = importer.importProcesses(matchResult, reposDir, dbPath);

            expect(summary2.imported).toBe(0);
            expect(summary2.skipped).toBe(4);
            expect(summary2.failed).toBe(0);

            // DB count should still be 4
            const db = new Database(dbPath);
            const count = (db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
            expect(count).toBe(4);
            db.close();
        });

        it('should handle corrupt JSON files gracefully', () => {
            const reposDir = path.join(tempDir, 'repos');
            const wsId = 'ws-corrupt';
            const processesDir = path.join(reposDir, wsId, 'processes');

            const good = makeProcess('proc-good', wsId);
            writeJSON(path.join(processesDir, 'index.json'), [
                good.index,
                { id: 'proc-bad', workspaceId: wsId, status: 'completed', type: 'clarification', startTime: '2024-01-01T00:00:00Z', promptPreview: 'bad' },
            ]);
            writeJSON(path.join(processesDir, 'proc-good.json'), good.stored);
            fs.writeFileSync(path.join(processesDir, 'proc-bad.json'), 'not json');

            const dbPath = createDb(tempDir);
            const scanResult = importer.scan(reposDir);
            const workspaces: WorkspaceInfo[] = [{ id: wsId, name: 'Corrupt WS', rootPath: '/tmp' }];
            const matchResult = importer.matchWorkspaces(scanResult, workspaces);

            const summary = importer.importProcesses(matchResult, reposDir, dbPath);

            expect(summary.imported).toBe(1);
            expect(summary.failed).toBe(1);
        });

        it('should emit progress events', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);
            const dbPath = createDb(tempDir);

            const scanResult = importer.scan(reposDir);
            const matchResult = importer.matchWorkspaces(scanResult, REGISTERED_WORKSPACES);

            const events: ImportProgress[] = [];
            importer.importProcesses(matchResult, reposDir, dbPath, (e) => events.push(e));

            expect(events.length).toBeGreaterThan(0);
            const doneEvent = events.find(e => e.phase === 'done');
            expect(doneEvent).toBeDefined();
            expect(doneEvent!.summary!.imported).toBe(4);
        });

        it('should import archived processes with archived=1', () => {
            const reposDir = path.join(tempDir, 'repos');
            const wsId = 'ws-archived';
            const p1 = makeProcess('proc-arch-1', wsId);

            writeJSON(path.join(reposDir, wsId, 'processes', 'index.json'), []);
            writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2025-03', 'index.json'), [p1.index]);
            writeJSON(path.join(reposDir, wsId, 'processes', 'pruned', '2025-03', 'proc-arch-1.json'), p1.stored);

            const dbPath = createDb(tempDir);
            const scanResult = importer.scan(reposDir);
            const workspaces: WorkspaceInfo[] = [{ id: wsId, name: 'Archived WS', rootPath: '/tmp' }];
            const matchResult = importer.matchWorkspaces(scanResult, workspaces);

            const summary = importer.importProcesses(matchResult, reposDir, dbPath);
            expect(summary.imported).toBe(1);

            const db = new Database(dbPath);
            const row = db.prepare('SELECT archived FROM processes WHERE id = ?').get('proc-arch-1') as { archived: number };
            expect(row.archived).toBe(1);
            db.close();
        });

        it('should handle empty matched list', () => {
            const reposDir = path.join(tempDir, 'repos');
            buildFixtures(reposDir);
            const dbPath = createDb(tempDir);

            const scanResult = importer.scan(reposDir);
            const matchResult = importer.matchWorkspaces(scanResult, []);

            const summary = importer.importProcesses(matchResult, reposDir, dbPath);

            expect(summary.imported).toBe(0);
            expect(summary.skipped).toBe(0);
            expect(summary.failed).toBe(0);
            expect(summary.perWorkspace).toHaveLength(0);
        });
    });
});
