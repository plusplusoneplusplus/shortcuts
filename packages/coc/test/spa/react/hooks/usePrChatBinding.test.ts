/**
 * Tests for usePrChatBinding hook — localStorage binding, createChat, context pattern.
 *
 * Validates that the hook stores/restores bindings in localStorage,
 * sends correct pullRequestChat context (workspaceId, prId, repoId, prTitle) so the
 * backend prompt-builder emits the PR framing sentence, and manages loading/error/taskId states.
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
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
}));

import { usePrChatBinding } from '../../../../src/server/spa/client/react/features/git/hooks/usePrChatBinding';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'hooks', 'usePrChatBinding.ts'
);

describe('usePrChatBinding', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockClient.queue.enqueue.mockResolvedValue({ task: { id: 'task-pr-popout' } });
    });

    it('exports UsePrChatBindingOptions interface', () => {
        expect(source).toContain('export interface UsePrChatBindingOptions');
    });

    it('exports UsePrChatBindingReturn interface', () => {
        expect(source).toContain('export interface UsePrChatBindingReturn');
    });

    it('exports usePrChatBinding function', () => {
        expect(source).toContain('export function usePrChatBinding');
    });

    describe('options shape', () => {
        it('accepts workspaceId', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts prId', () => {
            expect(source).toContain('prId: string');
        });

        it('accepts optional filePath for context', () => {
            expect(source).toContain('filePath?: string');
        });

        it('accepts optional repoId for multi-repo support', () => {
            expect(source).toContain('repoId?: string');
        });

        it('accepts optional prTitle for AI framing sentence', () => {
            expect(source).toContain('prTitle?: string');
        });
    });

    describe('return shape', () => {
        it('returns taskId', () => {
            expect(source).toContain('taskId: string | null');
        });

        it('returns loading flag', () => {
            expect(source).toContain('loading: boolean');
        });

        it('returns error', () => {
            expect(source).toContain('error: string | null');
        });

        it('returns createChat function', () => {
            expect(source).toContain('createChat: (prompt: string');
        });
    });

    describe('localStorage binding', () => {
        it('uses prChat binding prefix in localStorage', () => {
            expect(source).toContain('coc.prChat.binding.');
        });

        it('derives binding keys from workspace, repo, PR id, and review target discriminator', () => {
            expect(source).toContain('getReviewChatTargetStorageId');
            expect(source).toContain("type: 'pr'");
            expect(source).toContain('workspaceId: opts.workspaceId');
            expect(source).toContain('repoId: opts.repoId');
            expect(source).toContain('prId: opts.prId');
        });

        it('stores binding to localStorage after createChat success', () => {
            expect(source).toContain('storeBinding({ workspaceId, repoId, prId }, newTaskId)');
        });

        it('restores binding from localStorage on mount', () => {
            expect(source).toContain('getStoredBinding({ workspaceId, repoId, prId })');
        });

        it('refreshes binding when the scoped review target identity changes via useEffect', () => {
            expect(source).toContain('[workspaceId, repoId, prId]');
        });
    });

    describe('createChat context pattern', () => {
        it('sends pullRequestChat context (not the legacy prChat key)', () => {
            expect(source).toContain('pullRequestChat: { prId, repoId, prTitle }');
            expect(source).not.toContain('prChat: {');
        });

        it('includes prId in pullRequestChat context', () => {
            expect(source).toContain('pullRequestChat: { prId, repoId, prTitle }');
        });

        it('includes repoId in pullRequestChat context for multi-repo support', () => {
            expect(source).toContain('repoId,');
        });

        it('includes prTitle in pullRequestChat context for AI framing', () => {
            expect(source).toContain('prTitle }');
        });

        it('uses queue.enqueue to create chat task', () => {
            expect(source).toContain('queue.enqueue');
        });

        it('sets mode to ask', () => {
            expect(source).toContain("mode: options.mode ?? 'ask'");
        });

        it('includes workspaceId in payload so agent CWD resolves to workspace rootPath', () => {
            expect(source).toContain('workspaceId,');
        });

        it('forwards composer AI selection and attachments into the queue payload', () => {
            expect(source).toContain('options.attachments');
            expect(source).toContain('provider: options.provider');
            expect(source).toContain('model: options.model');
            expect(source).toContain('reasoningEffort: options.reasoningEffort');
            expect(source).toContain('config: options.config');
        });

        it('preserves composer send options while binding pull request context', async () => {
            const attachments = [{ name: 'risk.txt', mimeType: 'text/plain', size: 4, dataUrl: 'data:text/plain;base64,cmlzaw==' }];
            const { result } = renderHook(() => usePrChatBinding({
                workspaceId: 'ws-1',
                prId: '42',
                filePath: 'src/app.ts',
                repoId: 'repo-1',
                prTitle: 'Improve review chat',
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
                        pullRequestChat: { prId: '42', repoId: 'repo-1', prTitle: 'Improve review chat' },
                    },
                },
                config: { effortTier: 'high' },
            });
            expect(localStorage.getItem('coc.prChat.binding.pr.ws-1.repo-1.42.current')).toBe('task-pr-popout');
            expect(localStorage.getItem('coc.prChat.binding.42')).toBeNull();
        });

        it('does not collide for the same PR id across workspaces or repos', async () => {
            const { result, rerender } = renderHook(
                ({ workspaceId, repoId }: { workspaceId: string; repoId: string }) => usePrChatBinding({
                    workspaceId,
                    prId: '42',
                    repoId,
                    prTitle: 'Improve review chat',
                }),
                { initialProps: { workspaceId: 'ws-1', repoId: 'repo-1' } },
            );

            mockClient.queue.enqueue.mockResolvedValueOnce({ task: { id: 'task-ws-1-repo-1' } });
            await act(async () => {
                await result.current.createChat('first workspace prompt');
            });

            expect(result.current.taskId).toBe('task-ws-1-repo-1');
            expect(localStorage.getItem('coc.prChat.binding.pr.ws-1.repo-1.42.current')).toBe('task-ws-1-repo-1');

            await act(async () => {
                rerender({ workspaceId: 'ws-2', repoId: 'repo-1' });
            });
            expect(result.current.taskId).toBeNull();

            mockClient.queue.enqueue.mockResolvedValueOnce({ task: { id: 'task-ws-2-repo-1' } });
            await act(async () => {
                await result.current.createChat('second workspace prompt');
            });

            expect(localStorage.getItem('coc.prChat.binding.pr.ws-1.repo-1.42.current')).toBe('task-ws-1-repo-1');
            expect(localStorage.getItem('coc.prChat.binding.pr.ws-2.repo-1.42.current')).toBe('task-ws-2-repo-1');

            await act(async () => {
                rerender({ workspaceId: 'ws-2', repoId: 'repo-2' });
            });
            expect(result.current.taskId).toBeNull();

            mockClient.queue.enqueue.mockResolvedValueOnce({ task: { id: 'task-ws-2-repo-2' } });
            await act(async () => {
                await result.current.createChat('second repo prompt');
            });

            expect(localStorage.getItem('coc.prChat.binding.pr.ws-2.repo-1.42.current')).toBe('task-ws-2-repo-1');
            expect(localStorage.getItem('coc.prChat.binding.pr.ws-2.repo-2.42.current')).toBe('task-ws-2-repo-2');

            await act(async () => {
                rerender({ workspaceId: 'ws-1', repoId: 'repo-1' });
            });
            expect(result.current.taskId).toBe('task-ws-1-repo-1');
        });
    });

    describe('state management', () => {
        it('sets loading true during createChat', () => {
            expect(source).toContain('setLoading(true)');
        });

        it('sets loading false in finally block', () => {
            expect(source).toContain('setLoading(false)');
        });

        it('sets error on failure', () => {
            expect(source).toContain("setError(err?.message ?? 'Failed to create PR chat')");
        });

        it('clears error before create', () => {
            expect(source).toContain('setError(null)');
        });
    });
});
