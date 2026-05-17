/**
 * Tests for usePullRequestChatBinding hook — binding fetch, createChat, state.
 *
 * Validates binding lookup on prId change, 404 → empty state, createChat
 * task creation + binding POST with pullRequestChat context blocks, and
 * error handling. Mirrors the useCommitChatBinding test contract.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'pull-requests', 'hooks', 'usePullRequestChatBinding.ts',
);

describe('usePullRequestChatBinding', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    it('exports UsePullRequestChatBindingOptions interface', () => {
        expect(source).toContain('export interface UsePullRequestChatBindingOptions');
    });

    it('exports UsePullRequestChatBindingReturn interface', () => {
        expect(source).toContain('export interface UsePullRequestChatBindingReturn');
    });

    it('exports usePullRequestChatBinding function', () => {
        expect(source).toContain('export function usePullRequestChatBinding');
    });

    describe('binding fetch on mount', () => {
        it('fetches binding via GET when prId changes', () => {
            expect(source).toContain('pullRequests.getChatBinding(workspaceId, prId)');
        });

        it('sets taskId from binding response', () => {
            expect(source).toContain('setTaskId(data.taskId)');
        });

        it('resets state when prId changes', () => {
            expect(source).toContain('setLoading(true)');
            expect(source).toContain('setError(null)');
            expect(source).toContain('setTaskId(null)');
        });

        it('uses useEffect with workspaceId+prId dependency', () => {
            expect(source).toContain('[workspaceId, prId]');
        });
    });

    describe('binding 404 → empty state', () => {
        it('treats 404 as no binding (not an error)', () => {
            expect(source).toContain("err?.status === 404 || err?.message?.includes('404')");
            expect(source).toMatch(/includes\('404'\)\)\s*setTaskId\(null\)/);
        });

        it('sets error for non-404 failures', () => {
            expect(source).toContain("setError('Failed to load pull request chat')");
        });
    });

    describe('pr switch resets state', () => {
        it('resets taskId to null on prId change', () => {
            const effectBlock = source.substring(
                source.indexOf('useEffect(() => {'),
                source.indexOf('[workspaceId, prId]') + 50,
            );
            expect(effectBlock).toContain('setTaskId(null)');
            expect(effectBlock).toContain('setLoading(true)');
            expect(effectBlock).toContain('setError(null)');
        });

        it('cancels in-flight request on cleanup', () => {
            expect(source).toContain('let cancelled = false');
            expect(source).toContain('cancelled = true');
            expect(source).toContain('if (cancelled) return');
        });
    });

    describe('createChat creates task + binding', () => {
        it('POSTs to /queue with chat payload', () => {
            expect(source).toContain('queue.enqueue');
            expect(source).toContain("kind: 'chat'");
            expect(source).toContain("mode: 'ask'");
        });

        it('includes pullRequestChat in context', () => {
            expect(source).toContain('pullRequestChat: { prId, prNumber, prTitle, repoId }');
        });

        it('extracts taskId from nested task object (server returns { task: { id } })', () => {
            expect(source).toContain("res.task?.id ?? (res as { id?: string }).id");
        });

        it('POSTs binding after task creation', () => {
            expect(source).toContain('pullRequests.createChatBinding(workspaceId, prId, newTaskId)');
        });

        it('sets taskId on success', () => {
            expect(source).toContain('setTaskId(newTaskId)');
            expect(source).toContain('return newTaskId');
        });
    });

    describe('createChat failure sets error', () => {
        it('sets error message on failure', () => {
            expect(source).toContain("setError(err?.message ?? 'Failed to create pull request chat')");
        });

        it('returns null on failure', () => {
            const catchBlock = source.substring(
                source.lastIndexOf('catch (err: any)'),
                source.lastIndexOf('catch (err: any)') + 200,
            );
            expect(catchBlock).toContain('return null');
        });
    });

    it('returns taskId, loading, error, and createChat', () => {
        expect(source).toContain('return { taskId, loading, error, createChat }');
    });

    it('exits early when prId is empty', () => {
        expect(source).toContain('if (!prId) { setTaskId(null); return; }');
    });
});
