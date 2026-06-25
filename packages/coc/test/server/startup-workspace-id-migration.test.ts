import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    computeWorkspaceId,
    FileProcessStore,
    SqliteProcessStore,
    type AIProcess,
    type WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import { migrateWorkspaceIdsToV2IfNeeded } from '../../src/server/storage/startup-workspace-id-migration';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-id-v2-migration-test-'));
}

function makeWorkspace(id: string, rootPath: string, overrides?: Partial<WorkspaceInfo>): WorkspaceInfo {
    return {
        id,
        name: path.basename(rootPath),
        rootPath,
        ...overrides,
    };
}

function makeProcess(id: string, workspaceId: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'completed',
        startTime: new Date('2026-01-01T00:00:00.000Z'),
        endTime: new Date('2026-01-01T00:01:00.000Z'),
        metadata: { type: 'ai', workspaceId },
        ...overrides,
    };
}

function scalarCount(row: unknown): number {
    return (row as { cnt: number }).cnt;
}

describe('migrateWorkspaceIdsToV2IfNeeded', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = createTempDir();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('migrates SQLite workspace records, process history, seen state, repo data, and persisted references', async () => {
        const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const oldId = 'ws-legacy-sqlite';
            const rootPath = path.join(dataDir, 'repo');
            const newId = computeWorkspaceId('raw-host-a', rootPath);
            await store.registerWorkspace(makeWorkspace(oldId, rootPath));
            await store.addProcess(makeProcess('p1', oldId));
            const seenAt = '2026-01-01T00:01:00.000Z';
            store.markSeen('p1', seenAt);

            const db = store.getDatabase();
            db.prepare('INSERT INTO commit_chat_bindings (workspace_id, commit_hash, task_id, created_at) VALUES (?, ?, ?, ?)').run(oldId, 'abc123', 'p1', seenAt);
            db.prepare('INSERT INTO note_chat_bindings (workspace_id, note_path, task_id, created_at) VALUES (?, ?, ?, ?)').run(oldId, 'notes/a.md', 'p1', seenAt);
            db.prepare('INSERT INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at) VALUES (?, ?, ?, ?)').run(oldId, '42', 'p1', seenAt);
            db.prepare('INSERT INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at) VALUES (?, ?, ?, ?)').run('gh_owner_repo', '43', 'p-origin', seenAt);
            db.prepare('INSERT INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at) VALUES (?, ?, ?, ?)').run(oldId, 'wi-1', 'p1', seenAt);
            db.prepare('INSERT INTO task_groups (workspace_id, group_id, type, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(oldId, 'g1', 'ralph', 'Ralph', 'running', seenAt, seenAt);
            db.prepare('INSERT INTO task_group_members (workspace_id, group_id, role, task_id, process_id, linked_at) VALUES (?, ?, ?, ?, ?, ?)').run(oldId, 'g1', 'iteration', 't1', 'p1', seenAt);
            db.prepare('INSERT INTO queue_tasks (id, repo_id, type, created_at) VALUES (?, ?, ?, ?)').run('q1', oldId, 'chat', Date.now());
            db.prepare('INSERT INTO queue_repo_state (repo_id) VALUES (?)').run(oldId);
            db.exec('CREATE TABLE IF NOT EXISTS queue_repo_paths (repo_id TEXT PRIMARY KEY, root_path TEXT NOT NULL)');
            db.prepare('INSERT INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(oldId, rootPath);
            db.prepare('INSERT INTO schedule_runs (id, schedule_id, repo_id, started_at, status) VALUES (?, ?, ?, ?, ?)').run('sr1', 'sched1', oldId, seenAt, 'running');
            db.exec('ALTER TABLE loops ADD COLUMN workspace_id TEXT');
            db.prepare('INSERT INTO loops (id, process_id, interval_ms, created_at, expires_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?)').run('loop1', 'p1', 1000, seenAt, seenAt, oldId);
            db.exec('CREATE TABLE IF NOT EXISTS container_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT \'active\', routing_override_agent_id TEXT, routing_override_workspace_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
            db.exec('CREATE TABLE IF NOT EXISTS container_session_turns (session_id TEXT NOT NULL, turn_index INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, routing_agent_id TEXT NOT NULL, routing_workspace_id TEXT NOT NULL, routing_confidence REAL NOT NULL DEFAULT 1.0, routing_reason TEXT NOT NULL DEFAULT \'\', downstream_process_id TEXT, timestamp TEXT NOT NULL, PRIMARY KEY (session_id, turn_index))');
            db.prepare('INSERT INTO container_sessions (id, routing_override_agent_id, routing_override_workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('cs1', 'agent-a', oldId, seenAt, seenAt);
            db.prepare('INSERT INTO container_session_turns (session_id, turn_index, role, content, routing_agent_id, routing_workspace_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)').run('cs1', 0, 'user', 'hi', 'agent-a', oldId, seenAt);

            const oldDataDir = path.join(dataDir, 'repos', oldId);
            fs.mkdirSync(oldDataDir, { recursive: true });
            fs.writeFileSync(path.join(oldDataDir, 'preferences.json'), '{"ok":true}');

            const result = await migrateWorkspaceIdsToV2IfNeeded(dataDir, store, 'raw-host-a');

            expect(result).toEqual({ migrated: 1, renames: [{ oldId, newId }], conflicts: [] });
            expect(fs.existsSync(oldDataDir)).toBe(false);
            expect(fs.readFileSync(path.join(dataDir, 'repos', newId, 'preferences.json'), 'utf8')).toBe('{"ok":true}');

            const workspaces = await store.getWorkspaces();
            expect(workspaces.map(w => w.id)).toEqual([newId]);
            const process = await store.getProcess('p1');
            expect(process?.metadata?.workspaceId).toBe(newId);
            expect(store.getSeenMap(oldId)).toEqual({});
            expect(store.getSeenMap(newId)).toEqual({ p1: seenAt });

            for (const table of ['commit_chat_bindings', 'note_chat_bindings', 'pull_request_chat_bindings', 'work_item_chat_bindings', 'task_groups', 'task_group_members']) {
                expect(scalarCount(db.prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE workspace_id = ?`).get(newId))).toBeGreaterThan(0);
                expect(scalarCount(db.prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE workspace_id = ?`).get(oldId))).toBe(0);
            }
            expect(scalarCount(db.prepare('SELECT COUNT(*) AS cnt FROM pull_request_chat_bindings WHERE workspace_id = ?').get('gh_owner_repo'))).toBe(1);
            for (const table of ['queue_tasks', 'queue_repo_state', 'queue_repo_paths', 'schedule_runs']) {
                expect(scalarCount(db.prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE repo_id = ?`).get(newId))).toBeGreaterThan(0);
                expect(scalarCount(db.prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE repo_id = ?`).get(oldId))).toBe(0);
            }
            expect(scalarCount(db.prepare('SELECT COUNT(*) AS cnt FROM loops WHERE workspace_id = ?').get(newId))).toBe(1);
            expect(scalarCount(db.prepare('SELECT COUNT(*) AS cnt FROM container_sessions WHERE routing_override_workspace_id = ?').get(newId))).toBe(1);
            expect(scalarCount(db.prepare('SELECT COUNT(*) AS cnt FROM container_session_turns WHERE routing_workspace_id = ?').get(newId))).toBe(1);
            expect(stderrSpy.mock.calls.some(call => String(call[0]).includes(`Migrated workspace ${oldId}`))).toBe(true);
        } finally {
            store.close();
        }
    });

    it('migrates file-backed workspace records, repo data, active index entries, and process files', async () => {
        const store = new FileProcessStore({ dataDir });
        const oldId = 'ws-legacy-file';
        const rootPath = path.join(dataDir, 'repo');
        const newId = computeWorkspaceId('raw-host-b', rootPath);
        await store.registerWorkspace(makeWorkspace(oldId, rootPath));
        await store.addProcess(makeProcess('p-file', oldId));
        fs.writeFileSync(path.join(dataDir, 'repos', oldId, 'preferences.json'), '{"file":true}');

        const result = await migrateWorkspaceIdsToV2IfNeeded(dataDir, store, 'raw-host-b');

        expect(result).toEqual({ migrated: 1, renames: [{ oldId, newId }], conflicts: [] });
        expect(fs.existsSync(path.join(dataDir, 'repos', oldId))).toBe(false);
        expect(fs.readFileSync(path.join(dataDir, 'repos', newId, 'preferences.json'), 'utf8')).toBe('{"file":true}');
        expect((await store.getWorkspaces()).map(w => w.id)).toEqual([newId]);
        expect(await store.getProcess('p-file', oldId)).toBeUndefined();
        expect((await store.getProcess('p-file', newId))?.metadata?.workspaceId).toBe(newId);

        const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'repos', newId, 'processes', 'index.json'), 'utf8')) as Array<{ workspaceId: string }>;
        expect(index.every(entry => entry.workspaceId === newId)).toBe(true);
        const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'repos', newId, 'processes', 'p-file.json'), 'utf8')) as { workspaceId: string; process: { metadata?: { workspaceId?: string } } };
        expect(stored.workspaceId).toBe(newId);
        expect(stored.process.metadata?.workspaceId).toBe(newId);
    });

    it('skips virtual and already-v2 workspaces', async () => {
        const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        try {
            const v2Id = computeWorkspaceId('raw-host-c', path.join(dataDir, 'repo'));
            await store.registerWorkspace(makeWorkspace('my_work', '/virtual/my-work', { virtual: true }));
            await store.registerWorkspace(makeWorkspace(v2Id, path.join(dataDir, 'repo')));

            const result = await migrateWorkspaceIdsToV2IfNeeded(dataDir, store, 'raw-host-c');

            expect(result).toEqual({ migrated: 0, renames: [], conflicts: [] });
            expect((await store.getWorkspaces()).map(w => w.id).sort()).toEqual(['my_work', v2Id].sort());
        } finally {
            store.close();
        }
    });

    it('surfaces conflicts without overwriting an existing target workspace or data directory', async () => {
        const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        try {
            const oldId = 'ws-legacy-conflict';
            const rootPath = path.join(dataDir, 'repo');
            const newId = computeWorkspaceId('raw-host-d', rootPath);
            await store.registerWorkspace(makeWorkspace(oldId, rootPath));
            await store.registerWorkspace(makeWorkspace(newId, rootPath));
            fs.mkdirSync(path.join(dataDir, 'repos', oldId), { recursive: true });
            fs.writeFileSync(path.join(dataDir, 'repos', oldId, 'old.txt'), 'old');
            fs.mkdirSync(path.join(dataDir, 'repos', newId), { recursive: true });
            fs.writeFileSync(path.join(dataDir, 'repos', newId, 'new.txt'), 'new');

            const result = await migrateWorkspaceIdsToV2IfNeeded(dataDir, store, 'raw-host-d');

            expect(result.migrated).toBe(0);
            expect(result.conflicts).toEqual([{ oldId, newId, reason: 'target-workspace-exists' }]);
            expect(fs.readFileSync(path.join(dataDir, 'repos', oldId, 'old.txt'), 'utf8')).toBe('old');
            expect(fs.readFileSync(path.join(dataDir, 'repos', newId, 'new.txt'), 'utf8')).toBe('new');
            expect((await store.getWorkspaces()).map(w => w.id).sort()).toEqual([oldId, newId].sort());
        } finally {
            store.close();
        }
    });
});
