/**
 * Task Comments Anchor Relocation Tests
 *
 * Tests for server-side anchor relocation in the GET /api/comments/:wsId/:taskPath endpoint.
 * Validates that comments with anchors are relocated when file content drifts,
 * and that edge cases (no anchor, missing file, no drift, unfound text) are handled correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { TaskCommentsManager } from '../../src/server/task-comments-handler';
import type { TaskComment, CommentsStorage, CommentAnchor } from '../../src/server/task-comments-handler';
import { createAnchorData, needsRelocationCheck } from '@plusplusoneplusplus/pipeline-core';
import { resolveTaskRoot } from '../../src/server/task-root-resolver';

// ============================================================================
// HTTP Helpers
// ============================================================================

function httpRequest(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function getJSON(url: string) {
    return httpRequest(url);
}

function postJSON(url: string, data: unknown) {
    return httpRequest(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Test Helpers
// ============================================================================

/** Original file content for relocation tests. */
const ORIGINAL_CONTENT = [
    '# My Task',
    '',
    'First paragraph of the task.',
    '',
    '## Section A',
    '',
    'Important text that we comment on.',
    '',
    '## Section B',
    '',
    'Some other content here.',
].join('\n');

/** File content shifted down — two new lines inserted before Section A. */
const SHIFTED_CONTENT = [
    '# My Task',
    '',
    'First paragraph of the task.',
    '',
    'New line one.',
    'New line two.',
    '',
    '## Section A',
    '',
    'Important text that we comment on.',
    '',
    '## Section B',
    '',
    'Some other content here.',
].join('\n');

/** File content where the anchored text is completely removed. */
const REMOVED_CONTENT = [
    '# My Task',
    '',
    'First paragraph of the task.',
    '',
    '## Section A',
    '',
    'Completely different content now.',
    '',
    '## Section B',
    '',
    'Some other content here.',
].join('\n');

/**
 * Create a comment with an anchor created from the original content.
 * The anchor targets "Important text that we comment on." on line 7.
 */
function makeAnchoredComment(id: string): TaskComment {
    const anchor = createAnchorData(ORIGINAL_CONTENT, 7, 7, 1, 34);
    return {
        id,
        filePath: 'docs/task1.md',
        selection: { startLine: 7, startColumn: 1, endLine: 7, endColumn: 34 },
        selectedText: 'Important text that we comment on.',
        comment: 'This needs work',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        anchor,
    };
}

/** Create a comment without any anchor (pre-anchor era). */
function makeUnanchoredComment(id: string): TaskComment {
    return {
        id,
        filePath: 'docs/task1.md',
        selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 29 },
        selectedText: 'First paragraph of the task.',
        comment: 'Looks good',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

/** Write a comments storage file directly (bypassing the manager). */
function writeCommentsFile(
    dataDir: string,
    wsId: string,
    taskPath: string,
    comments: TaskComment[]
): void {
    const manager = new TaskCommentsManager(dataDir);
    const hash = manager.hashFilePath(taskPath);
    const wsDir = path.join(dataDir, 'tasks-comments', wsId);
    fs.mkdirSync(wsDir, { recursive: true });
    const storage: CommentsStorage = {
        comments,
        settings: { showResolved: true, highlightColor: '#ffeb3b' },
    };
    fs.writeFileSync(path.join(wsDir, `${hash}.json`), JSON.stringify(storage, null, 2), 'utf8');
}

/** Read comments storage file directly from disk. */
function readCommentsFile(
    dataDir: string,
    wsId: string,
    taskPath: string
): TaskComment[] {
    const manager = new TaskCommentsManager(dataDir);
    const hash = manager.hashFilePath(taskPath);
    const file = path.join(dataDir, 'tasks-comments', wsId, `${hash}.json`);
    const content = fs.readFileSync(file, 'utf8');
    const storage: CommentsStorage = JSON.parse(content);
    return storage.comments;
}

// ============================================================================
// Unit Tests — relocateCommentsIfNeeded (via GET endpoint)
// ============================================================================

describe('Task Comments Anchor Relocation', () => {
    let tmpDir: string;
    let dataDir: string;
    let workspaceDir: string;
    let taskRootDir: string;
    let server: ExecutionServer;
    let baseUrl: string;
    const wsId = 'test-ws';
    const taskPath = 'docs/task1.md';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-reloc-'));
        dataDir = path.join(tmpDir, 'data');
        workspaceDir = path.join(tmpDir, 'workspace');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.mkdirSync(workspaceDir, { recursive: true });

        // Compute the task root (where task files now live)
        const taskRoot = resolveTaskRoot({ dataDir, rootPath: workspaceDir });
        taskRootDir = taskRoot.absolutePath;
        fs.mkdirSync(path.join(taskRootDir, 'docs'), { recursive: true });

        // Write the original file content to the task root
        fs.writeFileSync(path.join(taskRootDir, taskPath), ORIGINAL_CONTENT, 'utf8');

        // Create a minimal process store mock that resolves our workspace
        const mockStore = {
            getWorkspaces: async () => [{ id: wsId, rootPath: workspaceDir }],
            addProcess: async () => {},
            updateProcess: async () => {},
            getProcess: async () => undefined,
            getAllProcesses: async () => [],
            removeProcess: async () => {},
            clearProcesses: async () => 0,
            registerWorkspace: async () => {},
            removeWorkspace: async () => false,
            updateWorkspace: async () => undefined,
            getWikis: async () => [],
            registerWiki: async () => {},
            removeWiki: async () => false,
            updateWiki: async () => undefined,
            clearAllWorkspaces: async () => 0,
            clearAllWikis: async () => 0,
            getStorageStats: async () => ({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
            onProcessOutput: () => () => {},
            emitProcessOutput: () => {},
            emitProcessComplete: () => {},
            emitProcessEvent: () => {},
        } as any;

        server = await createExecutionServer({
            dataDir,
            port: 0,
            store: mockStore,
        });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('relocates stale comments when file content has drifted', async () => {
        const comment = makeAnchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [comment]);

        // Shift the file content down by inserting lines before the target
        fs.writeFileSync(path.join(taskRootDir, taskPath), SHIFTED_CONTENT, 'utf8');

        const resp = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp.status).toBe(200);
        const { comments } = JSON.parse(resp.body);
        expect(comments).toHaveLength(1);

        // The text moved from line 7 to line 10 (3 lines inserted)
        expect(comments[0].selection.startLine).toBe(10);
        expect(comments[0].selection.endLine).toBe(10);
    });

    it('skips relocation when comment has no anchor', async () => {
        const comment = makeUnanchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [comment]);

        const resp = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp.status).toBe(200);
        const { comments } = JSON.parse(resp.body);
        expect(comments).toHaveLength(1);
        // Selection should remain unchanged
        expect(comments[0].selection.startLine).toBe(3);
        expect(comments[0].selection.endLine).toBe(3);
    });

    it('skips relocation when file is missing', async () => {
        const comment = makeAnchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [comment]);

        // Delete the source file
        fs.unlinkSync(path.join(taskRootDir, taskPath));

        const resp = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp.status).toBe(200);
        const { comments } = JSON.parse(resp.body);
        expect(comments).toHaveLength(1);
        // Selection unchanged since file is gone
        expect(comments[0].selection.startLine).toBe(7);
        expect(comments[0].selection.endLine).toBe(7);
    });

    it('skips relocation when text has not drifted', async () => {
        const comment = makeAnchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [comment]);

        // File content is still original — no drift
        const resp = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp.status).toBe(200);
        const { comments } = JSON.parse(resp.body);
        expect(comments).toHaveLength(1);
        expect(comments[0].selection.startLine).toBe(7);
        expect(comments[0].selection.endLine).toBe(7);

        // Verify no write happened by checking file mtime didn't change
        // (This is a best-effort check; the real signal is the selection is unchanged)
    });

    it('leaves selection unchanged when anchor text is completely removed', async () => {
        const comment = makeAnchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [comment]);

        // Replace file content with version that removes the anchored text
        fs.writeFileSync(path.join(taskRootDir, taskPath), REMOVED_CONTENT, 'utf8');

        const resp = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp.status).toBe(200);
        const { comments } = JSON.parse(resp.body);
        expect(comments).toHaveLength(1);
        // Selection should remain at original position since text is gone
        expect(comments[0].selection.startLine).toBe(7);
        expect(comments[0].selection.endLine).toBe(7);
    });

    it('persists relocated positions so second GET does not re-relocate', async () => {
        const comment = makeAnchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [comment]);

        // Shift the file content
        fs.writeFileSync(path.join(taskRootDir, taskPath), SHIFTED_CONTENT, 'utf8');

        // First GET triggers relocation
        const resp1 = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp1.status).toBe(200);
        const comments1 = JSON.parse(resp1.body).comments;
        expect(comments1[0].selection.startLine).toBe(10);

        // Verify persisted to disk
        const diskComments = readCommentsFile(dataDir, wsId, taskPath);
        expect(diskComments[0].selection.startLine).toBe(10);
        expect(diskComments[0].anchor!.originalLine).toBe(10);

        // Second GET should return same positions and needsRelocationCheck should be false
        const resp2 = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp2.status).toBe(200);
        const comments2 = JSON.parse(resp2.body).comments;
        expect(comments2[0].selection.startLine).toBe(10);
        expect(comments2[0].selection.endLine).toBe(10);

        // Verify needsRelocationCheck returns false for the updated position
        const content = fs.readFileSync(path.join(taskRootDir, taskPath), 'utf8');
        const updatedComment = diskComments[0];
        expect(
            needsRelocationCheck(
                content,
                updatedComment.anchor!,
                updatedComment.selection.startLine,
                updatedComment.selection.endLine,
                updatedComment.selection.startColumn,
                updatedComment.selection.endColumn
            )
        ).toBe(false);
    });

    it('handles mix of anchored and unanchored comments', async () => {
        const anchored = makeAnchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        const unanchored = makeUnanchoredComment('ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [anchored, unanchored]);

        // Shift the file content
        fs.writeFileSync(path.join(taskRootDir, taskPath), SHIFTED_CONTENT, 'utf8');

        const resp = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp.status).toBe(200);
        const { comments } = JSON.parse(resp.body);
        expect(comments).toHaveLength(2);

        const relocatedAnchored = comments.find((c: TaskComment) => c.id === anchored.id);
        const unchangedUnanchored = comments.find((c: TaskComment) => c.id === unanchored.id);

        // Anchored comment should be relocated
        expect(relocatedAnchored.selection.startLine).toBe(10);
        // Unanchored comment should remain unchanged
        expect(unchangedUnanchored.selection.startLine).toBe(3);
    });

    it('does not write to disk when no comments need relocation', async () => {
        const comment = makeAnchoredComment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        writeCommentsFile(dataDir, wsId, taskPath, [comment]);

        // Note the mtime before the GET
        const manager = new TaskCommentsManager(dataDir);
        const hash = manager.hashFilePath(taskPath);
        const storageFile = path.join(dataDir, 'tasks-comments', wsId, `${hash}.json`);
        const statBefore = fs.statSync(storageFile);

        // Small delay to make mtime difference detectable
        await new Promise(r => setTimeout(r, 50));

        // File unchanged → needsRelocationCheck returns false → no write
        const resp = await getJSON(`${baseUrl}/api/comments/${wsId}/${taskPath}`);
        expect(resp.status).toBe(200);

        const statAfter = fs.statSync(storageFile);
        expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });
});

// ============================================================================
// Unit Tests — TaskCommentsManager.writeComments is accessible
// ============================================================================

describe('TaskCommentsManager.writeComments accessibility', () => {
    let tmpDir: string;
    let manager: TaskCommentsManager;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-reloc-mgr-'));
        manager = new TaskCommentsManager(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writeComments is callable as a public method', async () => {
        const comment: TaskComment = {
            id: 'test-id-1234',
            filePath: 'test.md',
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            selectedText: 'test',
            comment: 'A comment',
            status: 'open',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await manager.writeComments('ws1', 'test.md', [comment]);
        const comments = await manager.getComments('ws1', 'test.md');
        expect(comments).toHaveLength(1);
        expect(comments[0].id).toBe('test-id-1234');
    });
});
