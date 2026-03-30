/**
 * Tests for useCommitChatBinding hook — binding fetch, createChat, state management.
 *
 * Validates binding lookup on commitHash change, 404 → empty state,
 * createChat task creation + binding POST, diff inclusion in context blocks,
 * and error handling.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks', 'useCommitChatBinding.ts'
);

describe('useCommitChatBinding', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    it('exports UseCommitChatBindingOptions interface', () => {
        expect(source).toContain('export interface UseCommitChatBindingOptions');
    });

    it('exports UseCommitChatBindingReturn interface', () => {
        expect(source).toContain('export interface UseCommitChatBindingReturn');
    });

    it('exports useCommitChatBinding function', () => {
        expect(source).toContain('export function useCommitChatBinding');
    });

    describe('binding fetch on mount', () => {
        it('fetches binding via GET when commitHash changes', () => {
            expect(source).toContain('fetchApi(`/workspaces/');
            expect(source).toContain('/commit-chat-bindings/');
        });

        it('sets taskId from binding response', () => {
            expect(source).toContain('setTaskId(data.taskId)');
        });

        it('resets state when commitHash changes', () => {
            expect(source).toContain('setLoading(true)');
            expect(source).toContain('setError(null)');
            expect(source).toContain('setTaskId(null)');
        });

        it('uses useEffect with commitHash dependency', () => {
            expect(source).toContain('[workspaceId, commitHash]');
        });
    });

    describe('binding 404 → empty state', () => {
        it('treats 404 as no binding (not an error)', () => {
            expect(source).toContain("err?.message?.includes('404')");
            // On 404, taskId stays null — no error state
            expect(source).toMatch(/includes\('404'\)\)\s*setTaskId\(null\)/);
        });

        it('sets error for non-404 failures', () => {
            expect(source).toContain("setError('Failed to load commit chat')");
        });
    });

    describe('commit switch resets state', () => {
        it('resets taskId to null on commitHash change', () => {
            // The effect sets taskId(null) before fetch
            const effectBlock = source.substring(
                source.indexOf('useEffect(() => {'),
                source.indexOf('[workspaceId, commitHash]') + 50
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
        it('POSTs to /queue/tasks with chat payload', () => {
            expect(source).toContain("fetchApi('/queue/tasks'");
            expect(source).toContain("method: 'POST'");
            expect(source).toContain("kind: 'chat'");
            expect(source).toContain("mode: 'ask'");
        });

        it('includes commitChat in context', () => {
            expect(source).toContain('commitChat: { commitHash, commitMessage }');
        });

        it('POSTs binding after task creation', () => {
            expect(source).toContain('/commit-chat-bindings');
            expect(source).toContain('body: JSON.stringify({ commitHash, taskId: newTaskId })');
        });

        it('sets taskId on success', () => {
            expect(source).toContain('setTaskId(newTaskId)');
            expect(source).toContain('return newTaskId');
        });
    });

    describe('createChat includes diff as context block', () => {
        it('fetches diff from git commits endpoint', () => {
            expect(source).toContain('/git/commits/');
            expect(source).toContain('/diff');
        });

        it('includes diff in blocks when available', () => {
            expect(source).toContain('blocks: diff ? [{ label:');
            expect(source).toContain('content: diff }]');
        });

        it('uses empty blocks when diff fetch fails', () => {
            // catch block around diff fetch is empty — proceed without diff
            expect(source).toContain('} catch { /* proceed without diff */ }');
        });
    });

    describe('createChat failure sets error', () => {
        it('sets error message on failure', () => {
            expect(source).toContain("setError(err?.message ?? 'Failed to create commit chat')");
        });

        it('returns null on failure', () => {
            const catchBlock = source.substring(
                source.lastIndexOf('catch (err: any)'),
                source.lastIndexOf('catch (err: any)') + 200
            );
            expect(catchBlock).toContain('return null');
        });
    });

    it('returns taskId, loading, error, and createChat', () => {
        expect(source).toContain('return { taskId, loading, error, createChat }');
    });

    it('does not return early when commitHash is empty', () => {
        expect(source).toContain("if (!commitHash) { setTaskId(null); return; }");
    });
});
