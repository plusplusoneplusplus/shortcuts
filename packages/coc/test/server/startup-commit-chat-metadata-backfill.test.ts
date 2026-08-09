/**
 * Commit-Chat Metadata Backfill Tests
 *
 * Covers the startup data repair that gives binding-only commit chats their
 * `metadata.commitChat` back: bare vs `queue_` task IDs, idempotency, workspace
 * isolation, and the file-backed store no-op.
 *
 * Cross-platform (Linux/Mac/Windows) — uses an in-memory SQLite database and a
 * temp dataDir created with os.tmpdir()/path.join.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { initializeDatabase, FileProcessStore } from '@plusplusoneplusplus/forge';
import {
    backfillCommitChatMetadata,
    backfillCommitChatMetadataIfNeeded,
} from '../../src/server/storage/startup-commit-chat-metadata-backfill';

const FULL_HASH = '5fdf6cd18f978b84fb02b7ac82c740a4d2d7d5e3';

describe('backfillCommitChatMetadata', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
    });

    afterEach(() => {
        db.close();
    });

    function insertProcess(id: string, workspaceId: string, metadata: Record<string, unknown> | null): void {
        db.prepare(
            'INSERT INTO processes (id, workspace_id, type, status, start_time, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, workspaceId, 'chat', 'completed', new Date().toISOString(), metadata ? JSON.stringify(metadata) : null);
    }

    function bind(workspaceId: string, commitHash: string, taskId: string): void {
        db.prepare(
            'INSERT INTO commit_chat_bindings (workspace_id, commit_hash, task_id, created_at) VALUES (?, ?, ?, ?)',
        ).run(workspaceId, commitHash, taskId, new Date().toISOString());
    }

    function readMetadata(id: string): Record<string, unknown> {
        const row = db.prepare('SELECT metadata FROM processes WHERE id = ?').get(id) as { metadata: string | null };
        return row.metadata ? JSON.parse(row.metadata) : {};
    }

    it('fills the hash for a queue_-prefixed process bound by bare task ID', () => {
        insertProcess('queue_task-1', 'ws-a', { type: 'chat', workspaceId: 'ws-a' });
        bind('ws-a', FULL_HASH, 'task-1');

        expect(backfillCommitChatMetadata(db).updated).toBe(1);
        expect(readMetadata('queue_task-1').commitChat).toEqual({ commitHash: FULL_HASH });
    });

    it('fills the hash for a bare process ID bound by a queue_-prefixed task ID', () => {
        insertProcess('task-2', 'ws-a', { type: 'chat', workspaceId: 'ws-a' });
        bind('ws-a', 'abcd1234', 'queue_task-2');

        expect(backfillCommitChatMetadata(db).updated).toBe(1);
        expect(readMetadata('task-2').commitChat).toEqual({ commitHash: 'abcd1234' });
    });

    it('never invents a commit message', () => {
        insertProcess('queue_task-3', 'ws-a', { type: 'chat' });
        bind('ws-a', FULL_HASH, 'task-3');

        backfillCommitChatMetadata(db);
        expect(readMetadata('queue_task-3').commitChat).not.toHaveProperty('commitMessage');
    });

    it('preserves the rest of the process metadata', () => {
        insertProcess('queue_task-4', 'ws-a', { type: 'chat', workspaceId: 'ws-a', model: 'gpt-4', mode: 'ask' });
        bind('ws-a', FULL_HASH, 'task-4');

        backfillCommitChatMetadata(db);
        const metadata = readMetadata('queue_task-4');
        expect(metadata.model).toBe('gpt-4');
        expect(metadata.mode).toBe('ask');
        expect(metadata.commitChat).toEqual({ commitHash: FULL_HASH });
    });

    it('does not overwrite an existing association (rebased hash or saved message)', () => {
        insertProcess('queue_task-5', 'ws-a', {
            type: 'chat',
            commitChat: { commitHash: 'bbbb2222', commitMessage: 'Rebased subject' },
        });
        bind('ws-a', FULL_HASH, 'task-5');

        const result = backfillCommitChatMetadata(db);
        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(1);
        expect(readMetadata('queue_task-5').commitChat).toEqual({
            commitHash: 'bbbb2222',
            commitMessage: 'Rebased subject',
        });
    });

    it('is idempotent across repeated startups', () => {
        insertProcess('queue_task-6', 'ws-a', { type: 'chat' });
        bind('ws-a', FULL_HASH, 'task-6');

        expect(backfillCommitChatMetadata(db).updated).toBe(1);
        expect(backfillCommitChatMetadata(db).updated).toBe(0);
        expect(readMetadata('queue_task-6').commitChat).toEqual({ commitHash: FULL_HASH });
    });

    it('handles a process with null metadata', () => {
        insertProcess('queue_task-7', 'ws-a', null);
        bind('ws-a', 'dead1234', 'task-7');

        expect(backfillCommitChatMetadata(db).updated).toBe(1);
        expect(readMetadata('queue_task-7').commitChat).toEqual({ commitHash: 'dead1234' });
    });

    it('skips a binding whose process no longer exists', () => {
        bind('ws-a', FULL_HASH, 'task-gone');
        const result = backfillCommitChatMetadata(db);
        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(1);
    });

    it('keeps two workspaces binding the same hash isolated', () => {
        insertProcess('queue_task-a', 'ws-a', { type: 'chat' });
        insertProcess('queue_task-b', 'ws-b', { type: 'chat' });
        bind('ws-a', FULL_HASH, 'task-a');
        bind('ws-b', FULL_HASH, 'task-b');

        expect(backfillCommitChatMetadata(db).updated).toBe(2);
        expect(readMetadata('queue_task-a').commitChat).toEqual({ commitHash: FULL_HASH });
        expect(readMetadata('queue_task-b').commitChat).toEqual({ commitHash: FULL_HASH });
    });

    it('does not update a process in another workspace', () => {
        insertProcess('queue_task-x', 'ws-other', { type: 'chat' });
        bind('ws-a', FULL_HASH, 'task-x');

        const result = backfillCommitChatMetadata(db);
        expect(result.updated).toBe(0);
        expect(readMetadata('queue_task-x').commitChat).toBeUndefined();
    });

    it('is a no-op when there are no bindings', () => {
        insertProcess('queue_task-8', 'ws-a', { type: 'chat' });
        expect(backfillCommitChatMetadata(db)).toEqual({ updated: 0, skipped: 0 });
        expect(readMetadata('queue_task-8').commitChat).toBeUndefined();
    });
});

describe('backfillCommitChatMetadataIfNeeded', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-chat-backfill-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('leaves legacy file-backed processes unchanged rather than parsing prompts', async () => {
        const store = new FileProcessStore(dataDir);
        await store.addProcess({
            id: 'queue_file-task',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            fullPrompt: `Commit ${FULL_HASH} — explain it`,
            metadata: { type: 'chat', workspaceId: 'ws-file' },
        } as any);

        expect(backfillCommitChatMetadataIfNeeded(store as any)).toEqual({ updated: 0, skipped: 0 });
        expect((await store.getProcess('queue_file-task'))?.metadata?.commitChat).toBeUndefined();
    });
});
