/**
 * Tests for useCommitChatBinding hook — binding fetch, createChat, state management.
 *
 * Validates binding lookup on commitHash change, 404 → empty state,
 * createChat task creation + binding POST, diff inclusion in context blocks,
 * and error handling.
 */
/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const { mockClient } = vi.hoisted(() => ({
    mockClient: {
        queue: {
            enqueue: vi.fn(),
        },
        git: {
            getCommitChatBinding: vi.fn(),
            createCommitChatBinding: vi.fn(),
        },
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
}));

import { useCommitChatBinding } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitChatBinding';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'hooks', 'useCommitChatBinding.ts'
);

describe('useCommitChatBinding', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient.git.getCommitChatBinding.mockResolvedValue({ taskId: null });
        mockClient.git.createCommitChatBinding.mockResolvedValue({});
        mockClient.queue.enqueue.mockResolvedValue({ task: { id: 'task-commit' } });
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
            expect(source).toContain('getCommitChatBinding(workspaceId, commitHash)');
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
            expect(source).toContain("err?.status === 404 || err?.message?.includes('404')");
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
        it('POSTs to /queue with chat payload', () => {
            expect(source).toContain('queue.enqueue');
            expect(source).toContain("kind: 'chat'");
            expect(source).toContain("mode: options.mode ?? 'ask'");
        });

        it('includes commitChat in context', () => {
            expect(source).toContain('commitChat: { commitHash, commitMessage }');
        });

        it('forwards composer AI selection and attachments into the queue payload', () => {
            expect(source).toContain('options.attachments');
            expect(source).toContain('provider: options.provider');
            expect(source).toContain('model: options.model');
            expect(source).toContain('reasoningEffort: options.reasoningEffort');
            expect(source).toContain('config: options.config');
        });

        it('does not fetch or inline diff (AI uses git tools instead)', () => {
            expect(source).not.toContain('/git/commits/');
            expect(source).not.toContain('blocks:');
        });

        it('extracts taskId from nested task object (server returns { task: { id } })', () => {
            expect(source).toContain("res.task?.id ?? (res as { id?: string }).id");
        });

        it('POSTs binding after task creation', () => {
            expect(source).toContain('createCommitChatBinding(workspaceId, commitHash, newTaskId)');
        });

        it('sets taskId on success', () => {
            expect(source).toContain('setTaskId(newTaskId)');
            expect(source).toContain('return newTaskId');
        });

        it('preserves composer send options while binding commit context', async () => {
            const attachments = [{ name: 'diff.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,abc' }];
            const { result } = renderHook(() => useCommitChatBinding({
                workspaceId: 'ws-1',
                commitHash: 'abc123',
                commitMessage: 'fix: bug',
            }));

            await act(async () => {
                await result.current.createChat('review prompt', {
                    mode: 'autopilot',
                    context: { skills: ['reviewer'] },
                    attachments,
                    provider: 'claude',
                    model: 'claude-sonnet-4.6',
                    reasoningEffort: 'high',
                    config: { effortTier: 'high' },
                    workingDirectory: '/workspace',
                });
            });

            expect(mockClient.queue.enqueue).toHaveBeenCalledWith({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: 'review prompt',
                    workingDirectory: '/workspace',
                    workspaceId: 'ws-1',
                    attachments,
                    provider: 'claude',
                    model: 'claude-sonnet-4.6',
                    reasoningEffort: 'high',
                    context: {
                        skills: ['reviewer'],
                        commitChat: { commitHash: 'abc123', commitMessage: 'fix: bug' },
                    },
                },
                config: { effortTier: 'high' },
            });
            expect(mockClient.git.createCommitChatBinding).toHaveBeenCalledWith('ws-1', 'abc123', 'task-commit');
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
