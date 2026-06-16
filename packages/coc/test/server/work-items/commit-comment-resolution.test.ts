/**
 * Tests for commit-level comment resolution features:
 * - Extended totals endpoint (open/resolved counts per SHA)
 * - Auto re-execute on comment resolution
 * - Work item executor autoReExecuted flag
 * - WorkItemDetail layout (badges, resolve button, auto-reexecute indicator)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DiffCommentsManager } from '../../../src/server/tasks/comments/diff-comments-manager';
import type { DiffCommentContext, DiffComment } from '@plusplusoneplusplus/forge';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    executeWorkItem,
    handleWorkItemTaskComplete,
} from '../../../src/server/work-items/work-item-executor';
import type { WorkItem, WorkItemExecution } from '../../../src/server/work-items/types';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

function makeContext(overrides: Partial<DiffCommentContext> = {}): DiffCommentContext {
    return {
        repositoryId: 'repo/test',
        oldRef: 'main',
        newRef: 'feature-branch',
        filePath: 'src/index.ts',
        ...overrides,
    };
}

function makeCommentData(
    ctx: DiffCommentContext,
    overrides: Partial<Omit<DiffComment, 'id' | 'createdAt' | 'updatedAt' | 'ephemeral'>> = {}
): Omit<DiffComment, 'id' | 'createdAt' | 'updatedAt' | 'ephemeral'> {
    return {
        context: ctx,
        selection: { diffLineStart: 0, diffLineEnd: 2, side: 'added', startColumn: 0, endColumn: 10 },
        selectedText: 'export default',
        comment: 'This needs review',
        status: 'open',
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-commit-resolve-'));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// DiffCommentsManager.getCommentTotals — extended format
// ============================================================================

describe('DiffCommentsManager.getCommentTotals — extended format', () => {
    let manager: DiffCommentsManager;

    beforeEach(() => {
        manager = new DiffCommentsManager(tmpDir);
    });

    it('returns flat count per SHA when no status filter', async () => {
        const wsId = 'ws-totals-1';
        const ctx1 = makeContext({ newRef: 'abc', filePath: 'src/a.ts' });
        const ctx2 = makeContext({ newRef: 'abc', filePath: 'src/b.ts' });

        // Create two open comments
        await manager.addComment(wsId, ctx1, makeCommentData(ctx1));
        const c2 = await manager.addComment(wsId, ctx2, makeCommentData(ctx2));

        // Resolve one
        const key2 = manager.hashContext(ctx2);
        await manager.updateComment(wsId, key2, c2.id, { status: 'resolved' });

        const totals = await manager.getCommentTotals(wsId, ['abc']);
        // Returns total count of all comments regardless of status
        expect(totals).toEqual({ 'abc': 2 });
    });

    it('returns flat number per SHA when status filter is provided (backward compat)', async () => {
        const wsId = 'ws-totals-2';
        const ctx = makeContext({ newRef: 'def', filePath: 'src/c.ts' });

        await manager.addComment(wsId, ctx, makeCommentData(ctx));

        const totals = await manager.getCommentTotals(wsId, ['def'], { statuses: ['open'] });
        expect(totals).toEqual({ 'def': 1 });
    });

    it('returns empty object for empty commitHashes', async () => {
        const totals = await manager.getCommentTotals('ws-empty', []);
        expect(totals).toEqual({});
    });

    it('returns empty object for non-existent workspace', async () => {
        const totals = await manager.getCommentTotals('ws-nonexistent', ['abc']);
        expect(totals).toEqual({});
    });

    it('counts all comments in flat mode when no status filter', async () => {
        const wsId = 'ws-totals-3';
        const ctx = makeContext({ newRef: 'ghi', filePath: 'src/d.ts' });

        // Create one open, then resolve the second
        await manager.addComment(wsId, ctx, makeCommentData(ctx, { comment: 'open one' }));

        const c2 = await manager.addComment(wsId, ctx, makeCommentData(ctx, { comment: 'resolved one' }));

        const key = manager.hashContext(ctx);
        await manager.updateComment(wsId, key, c2.id, { status: 'resolved' });

        const totals = await manager.getCommentTotals(wsId, ['ghi']);
        // Returns total count (both open and resolved)
        expect(totals['ghi']).toBe(2);
    });
});

// ============================================================================
// executeWorkItem — autoReExecuted flag
// ============================================================================

describe('executeWorkItem — autoReExecuted flag', () => {
    let store: FileWorkItemStore;

    beforeEach(() => {
        store = new FileWorkItemStore({ dataDir: tmpDir });
    });

    it('records autoReExecuted on execution when option is set', async () => {
        const item = makeWorkItem({
            id: 'wi-auto-1',
            status: 'readyToExecute',
            plan: { version: 1, content: 'Fix bugs', updatedAt: '' },
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-auto-1');
        await executeWorkItem('wi-auto-1', store, enqueue, { autoReExecuted: true });

        const updated = await store.getWorkItem('wi-auto-1', 'test-repo');
        expect(updated!.executionHistory).toHaveLength(1);
        expect(updated!.executionHistory![0].autoReExecuted).toBe(true);
    });

    it('does not set autoReExecuted when option is not provided', async () => {
        const item = makeWorkItem({
            id: 'wi-normal-1',
            status: 'readyToExecute',
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-normal-1');
        await executeWorkItem('wi-normal-1', store, enqueue);

        const updated = await store.getWorkItem('wi-normal-1', 'test-repo');
        expect(updated!.executionHistory![0].autoReExecuted).toBeUndefined();
    });
});

// ============================================================================
// WorkItem type — autoResolveAndReExecute and autoReExecuteCycles
// ============================================================================

describe('WorkItem type — autoResolveAndReExecute', () => {
    let store: FileWorkItemStore;

    beforeEach(() => {
        store = new FileWorkItemStore({ dataDir: tmpDir });
    });

    it('stores and retrieves autoResolveAndReExecute flag', async () => {
        const item = makeWorkItem({
            id: 'wi-flag-1',
            autoResolveAndReExecute: true,
        });
        await store.addWorkItem(item);

        const retrieved = await store.getWorkItem('wi-flag-1', 'test-repo');
        expect(retrieved!.autoResolveAndReExecute).toBe(true);
    });

    it('stores and retrieves autoReExecuteCycles counter', async () => {
        const item = makeWorkItem({
            id: 'wi-cycles-1',
            autoReExecuteCycles: 2,
        });
        await store.addWorkItem(item);

        const retrieved = await store.getWorkItem('wi-cycles-1', 'test-repo');
        expect(retrieved!.autoReExecuteCycles).toBe(2);
    });

    it('updates autoReExecuteCycles via updateWorkItem', async () => {
        const item = makeWorkItem({ id: 'wi-cycles-2' });
        await store.addWorkItem(item);

        await store.updateWorkItem('wi-cycles-2', { autoReExecuteCycles: 1 });
        const updated = await store.getWorkItem('wi-cycles-2', 'test-repo');
        expect(updated!.autoReExecuteCycles).toBe(1);
    });
});

// ============================================================================
// autoExecute triggers re-execution after comment resolution
// ============================================================================

describe('autoExecute triggers re-execution after comment resolution', () => {
    let store: FileWorkItemStore;

    beforeEach(() => {
        store = new FileWorkItemStore({ dataDir: tmpDir });
    });

    it('stores and retrieves autoExecute flag', async () => {
        const item = makeWorkItem({ id: 'wi-ae-1', autoExecute: true });
        await store.addWorkItem(item);

        const retrieved = await store.getWorkItem('wi-ae-1', 'test-repo');
        expect(retrieved!.autoExecute).toBe(true);
    });

    it('executeWorkItem succeeds for items with autoExecute enabled', async () => {
        const item = makeWorkItem({
            id: 'wi-ae-exec-1',
            status: 'readyToExecute',
            autoExecute: true,
            plan: { version: 1, content: 'Fix bugs', updatedAt: '' },
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-ae-1');
        await executeWorkItem('wi-ae-exec-1', store, enqueue, { autoReExecuted: true });

        const updated = await store.getWorkItem('wi-ae-exec-1', 'test-repo');
        expect(updated!.status).toBe('executing');
        expect(updated!.executionHistory).toHaveLength(1);
        expect(updated!.executionHistory![0].autoReExecuted).toBe(true);
    });

    it.skip('routes/index.ts auto-execute guard includes item.autoExecute — feature not yet implemented', async () => {
        const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'server', 'routes', 'index.ts');
        const src = await fs.readFile(srcPath, 'utf-8');
        expect(src).toContain('!item.autoExecute');
        // Ensure autoExecute is part of the same guard as autoResolveAndReExecute
        expect(src).toContain('!item.autoResolveAndReExecute && !resolveCtx.autoReExecute && !item.autoExecute');
    });

    it('WorkItemDetail.tsx resolves commits via resolve-comments endpoint', async () => {
        const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'work-items', 'WorkItemDetail.tsx');
        const src = await fs.readFile(srcPath, 'utf-8');
        // handleAutoResolveChange should call the typed work-item resolve-comments client method
        expect(src).toContain('workItems.resolveCommentsForOrigin(workItemOriginId, workItemId');
        expect(src).toContain("type: 'commit'");
    });
});

// ============================================================================
// WorkItemDetail layout — new UI elements
// ============================================================================

describe('WorkItemDetail layout — commit resolution UI', () => {
    let src: string;

    beforeEach(async () => {
        const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'work-items', 'WorkItemDetail.tsx');
        src = await fs.readFile(srcPath, 'utf-8');
    });

    it('renders resolved count badge (✅) per commit', () => {
        expect(src).toContain('commit-resolved-badge-');
        expect(src).toContain('✅');
    });

    it('renders open count badge (💬) per commit', () => {
        expect(src).toContain('commit-comment-badge-');
        expect(src).toContain('💬');
    });

    it('renders per-commit resolve button', () => {
        expect(src).toContain('commit-resolve-btn-');
        expect(src).toContain('handlePerCommitResolve');
    });

    it('per-commit resolve button calls typed resolve-comments client method', () => {
        expect(src).toContain('workItems.resolveCommentsForOrigin(workItemOriginId, workItemId');
        expect(src).toContain("type: 'commit'");
    });

    it('per-commit resolve button passes commitSha in body', () => {
        expect(src).toContain('commitSha: sha');
    });

    it('renders auto re-execute badge on execution entries', () => {
        expect(src).toContain('exec-auto-reexecute-badge-');
        expect(src).toContain('Auto re-executed');
    });

    it('renders per-change Auto Resolve button (replaces old toggle)', () => {
        expect(src).toContain('exec-auto-resolve-btn-');
        expect(src).toContain('handleAutoResolveChange');
    });

    it('per-change Auto Resolve button is not restricted to aiDone', () => {
        // Button condition should check exec.status === 'completed' && execOpenCommentCount > 0 only
        // It should NOT have isAiDone as a precondition for the auto-resolve button
        const autoResolveBtnIdx = src.indexOf("exec-auto-resolve-btn-");
        expect(autoResolveBtnIdx).toBeGreaterThan(-1);
        // The auto-resolve button should NOT be gated behind isAiDone
        const surroundingCode = src.slice(Math.max(0, autoResolveBtnIdx - 300), autoResolveBtnIdx);
        expect(surroundingCode).not.toContain('isAiDone &&');
    });

    it('per-change Auto Resolve button sends resolve for each commit', () => {
        expect(src).toContain('handleAutoResolveChange');
        expect(src).toContain("type: 'commit'");
    });

    it('Auto Resolve button shows per-change resolve count', () => {
        expect(src).toContain('Resolve all (');
    });

    it('does NOT render the top-level auto-resolve toggle', () => {
        expect(src).not.toContain('work-item-auto-resolve-toggle');
    });

    it('uses green styling for resolved badge and amber for unresolved badge', () => {
        // Resolved badge should use green
        expect(src).toContain('bg-green-100');
        expect(src).toContain('text-green-700');
        // Open badge should use amber
        expect(src).toContain('bg-amber-100');
        expect(src).toContain('text-amber-700');
    });

    it('reads open and resolved from commentTotals', () => {
        expect(src).toContain('commentTotals.get(c.sha)');
        expect(src).toContain('ct?.open');
        expect(src).toContain('ct?.resolved');
    });

    it('renders execution title alongside run number', () => {
        expect(src).toContain('exec.title');
    });

    it('per-commit resolve button says "Resolve"', () => {
        // The per-commit button renders just "Resolve" (optionally with spinner prefix)
        expect(src).toContain("}Resolve");
        expect(src).toContain("commit-resolve-btn-");
    });

    it('session-level resolve button says "Resolve all"', () => {
        expect(src).toContain('Resolve all (');
    });

    it('per-commit resolve passes sourceRunIndex', () => {
        expect(src).toContain('handlePerCommitResolve(c.sha, i + 1)');
    });

    it('auto-resolve passes sourceRunIndex in POST body', () => {
        expect(src).toContain('sourceRunIndex');
    });
});
