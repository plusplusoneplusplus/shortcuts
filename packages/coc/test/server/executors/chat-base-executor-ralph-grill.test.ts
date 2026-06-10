import { describe, expect, it, vi } from 'vitest';
import type { AutoFolderContext, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { buildRalphGrillSuffix } from '../../../src/server/executors/chat-base-executor';

class InspectableChatExecutor extends ChatExecutor {
    getRalphGrillState(processId: string) {
        return this.sessions.get(processId)?.ralphGrill;
    }
}

describe('buildRalphGrillSuffix', () => {
    const autoFolderContext = {
        tasksRoot: '/tmp/coc/notes/Plans',
        existingFolders: ['frontend', 'archive/old'],
    } as AutoFolderContext;

    it('keeps the Notes goal-file directive for ordinary Ralph grilling', () => {
        const suffix = buildRalphGrillSuffix(autoFolderContext);

        expect(suffix).toContain('/tmp/coc/notes/Plans/<chosen-folder>/<descriptive-name>.goal.md');
        expect(suffix).toContain('Existing folders: frontend');
        expect(suffix).not.toContain('Multi-agent grilling is enabled');
    });

    it('adds the multi-agent grilling directive only when a grill setup is enabled', () => {
        const suffix = buildRalphGrillSuffix(autoFolderContext, {
            grill: {
                enabled: true,
                depth: 'standard',
                agents: [
                    { role: 'ux', provider: 'claude', model: 'claude-sonnet-4.6' },
                ],
            },
        });

        expect(suffix).toContain('Multi-agent grilling is enabled');
        expect(suffix).toContain('Selected depth: standard');
        expect(suffix).toContain('UX Agent · claude/claude-sonnet-4.6');
        expect(suffix).toContain('/tmp/coc/notes/Plans/<chosen-folder>/<descriptive-name>.goal.md');
    });

    it('suppresses Notes goal-file output for Work Item Goal grilling', () => {
        const suffix = buildRalphGrillSuffix(autoFolderContext, {
            workItemGoal: {
                workspaceId: 'ws-1',
                workItemId: 'goal-1',
                title: 'Ship durable goals',
            },
        });

        expect(suffix).toContain('Work Item Goal "Ship durable goals"');
        expect(suffix).toContain('Do not create or require a Notes-backed `.goal.md` file');
        expect(suffix).toContain('save it as an immutable Goal content version');
        expect(suffix).not.toContain('/tmp/coc/notes/Plans');
    });

    it('stores completed grill-agent session IDs in per-process state', async () => {
        const store = {
            getProcess: vi.fn().mockResolvedValue({ metadata: { type: 'chat' } }),
            updateProcess: vi.fn().mockResolvedValue(undefined),
            emitProcessEvent: vi.fn(),
            emitProcessOutput: vi.fn(),
            registerFlushHandler: vi.fn(),
            unregisterFlushHandler: vi.fn(),
            appendConversationTurn: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProcessStore;
        const aiService = {
            isAvailable: vi.fn().mockResolvedValue({ available: true }),
            sendMessage: vi.fn(async (options: { prompt: string }) => {
                if (options.prompt.includes('Agent role: Product Agent')) {
                    return {
                        success: true,
                        response: JSON.stringify({
                            questions: [{ question: 'What product outcome should define success?', type: 'text' }],
                        }),
                        sessionId: 'product-session',
                    };
                }
                if (options.prompt.includes('Agent role: UX Agent')) {
                    return {
                        success: true,
                        response: JSON.stringify({
                            questions: [{ question: 'How should the grouped form look?', type: 'text' }],
                        }),
                        sessionId: 'ux-session',
                    };
                }
                if (options.prompt.includes('Agent role: Architecture/System Agent')) {
                    return {
                        success: false,
                        error: 'provider unavailable',
                    };
                }
                return { success: true, response: 'done', sessionId: 'main-session' };
            }),
        };
        const executor = new InspectableChatExecutor(store, {
            aiService: aiService as any,
            defaultTimeoutMs: 60_000,
            followUpSuggestions: { enabled: false, count: 0 },
            askUser: { enabled: true },
            resolveSkillConfig: vi.fn().mockResolvedValue({}),
            resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
            ralphMultiAgentGrillEnabled: true,
        });
        const task = {
            id: 'grill-task',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Design the new Ralph grilling experience',
                context: {
                    ralph: {
                        originalGoal: 'Design the new Ralph grilling experience',
                        phase: 'grilling',
                        grill: {
                            enabled: true,
                            depth: 'light',
                            agents: [
                                { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                                { role: 'ux', provider: 'copilot', model: 'gpt-5.5' },
                                { role: 'architecture-system', provider: 'copilot', model: 'gpt-5.5' },
                            ],
                        },
                    },
                },
            },
            config: {},
        } as unknown as QueuedTask;

        await executor.execute(task, 'Design the new Ralph grilling experience');

        const state = executor.getRalphGrillState(toQueueProcessId(task.id));
        expect(state?.roundsRun).toBe(1);
        expect(state?.agents.product?.sessionId).toBe('product-session');
        expect(state?.agents.ux?.sessionId).toBe('ux-session');
        expect(state?.agents['architecture-system']?.sessionId).toBeUndefined();
        expect(state?.agents['architecture-system']?.status).toBe('failed');
        expect(state?.askedQuestions).toEqual([
            'What product outcome should define success?',
            'How should the grouped form look?',
        ]);
    });
});
