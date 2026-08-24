/**
 * AC-03 — repo-group member context injection at chat dispatch.
 *
 * Both dispatch paths — first turns (ChatBaseExecutor.execute) and follow-ups
 * (FollowUpExecutor.executeFollowUp) — must append the live-member listing to
 * the outgoing prompt and pass the same member root paths via
 * `additionalDirectories`. Non-group workspaces are untouched, and stale
 * members are silently skipped.
 *
 * Both paths also record the injected block verbatim on the user turn
 * (`repoGroupContext`) so the chat UI can disclose it — the persisted message
 * text itself stays exactly what the user typed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { QueuedTask, AIProcess } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';
import { REPO_GROUP_CONTEXT_TAG } from '../../../src/server/workspaces/repo-group-chat-context';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// Same isolation mocks as chat-mode-executors.test.ts: keep async fs listing,
// image temp files, task roots, and output persistence off the real disk.
// Sync fs stays real — group.json reads/writes go through it.
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

const sdkMocks = createMockSDKService();

describe('repo-group chat context injection (AC-03)', () => {
    let tmpDir: string;
    let store: ReturnType<typeof createMockProcessStore>;
    let repoA: string;
    let repoB: string;
    let groupId: string;

    function makeOptions(overrides?: Partial<ChatModeExecutorOptions>): ChatModeExecutorOptions {
        return {
            aiService: sdkMocks.service as any,
            defaultTimeoutMs: 30_000,
            followUpSuggestions: { enabled: false, count: 3 },
            resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
            resolveWorkspaceIdForPath: vi.fn().mockResolvedValue(undefined),
            resolveAiServiceForProvider: () => sdkMocks.service as any,
            ...overrides,
        };
    }

    function makeChatTask(workspaceId: string, id = 'task-1'): QueuedTask {
        return {
            id,
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Hello',
                workspaceId,
            },
            config: {},
            displayName: 'Hello',
        };
    }

    function expectedBlock(): string {
        return (
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "My Team" members:\n' +
            `- Repo A: ${repoA}\n` +
            `- Repo B: ${repoB}\n` +
            `</${REPO_GROUP_CONTEXT_TAG}>`
        );
    }

    /**
     * The queue creates the process (with user turn 0 already persisted) before
     * the executor runs; `toQueueProcessId` maps the task id to the process id.
     */
    function seedFirstTurnProcess(workspaceId: string, taskId: string): AIProcess {
        const process: AIProcess = {
            id: toQueueProcessId(taskId),
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'Hello',
            workingDirectory: path.join(tmpDir, 'repos', workspaceId),
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
            metadata: { type: 'chat', workspaceId, provider: 'copilot', mode: 'ask' },
        };
        store.processes.set(process.id, process);
        return process;
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-inject-'));
        store = createMockProcessStore();
        repoA = path.join(tmpDir, 'checkouts', 'ws-v2-aaa');
        repoB = path.join(tmpDir, 'checkouts', 'ws-v2-bbb');
        fs.mkdirSync(repoA, { recursive: true });
        fs.mkdirSync(repoB, { recursive: true });
        await store.registerWorkspace({ id: 'ws-v2-aaa', name: 'Repo A', rootPath: repoA });
        await store.registerWorkspace({ id: 'ws-v2-bbb', name: 'Repo B', rootPath: repoB });
        const groupWs = await createRepoGroup(tmpDir, store, { name: 'My Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        groupId = groupWs.id;

        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI answer',
            sessionId: 'sess-1',
            toolCalls: [],
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('first turn (ChatBaseExecutor.execute)', () => {
        it('appends the member block to the prompt and passes member roots as additionalDirectories', async () => {
            const executor = new ChatExecutor(store, makeOptions(), tmpDir);

            await executor.execute(makeChatTask(groupId), 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt.endsWith(`\n\n${expectedBlock()}`)).toBe(true);
            expect(call.additionalDirectories).toEqual([repoA, repoB]);
        });

        it('skips stale members from both the block and additionalDirectories', async () => {
            await store.removeWorkspace('ws-v2-bbb');
            const executor = new ChatExecutor(store, makeOptions(), tmpDir);

            await executor.execute(makeChatTask(groupId), 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).toContain(`- Repo A: ${repoA}`);
            expect(call.prompt).not.toContain('Repo B');
            expect(call.additionalDirectories).toEqual([repoA]);
        });

        it('injects nothing for a non-group workspace', async () => {
            const executor = new ChatExecutor(store, makeOptions(), tmpDir);

            await executor.execute(makeChatTask('ws-v2-aaa'), 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).not.toContain(REPO_GROUP_CONTEXT_TAG);
            expect(call.additionalDirectories).toBeUndefined();
        });

        it('records the injected block on the user turn without touching its content', async () => {
            seedFirstTurnProcess(groupId, 'task-persist');
            const executor = new ChatExecutor(store, makeOptions(), tmpDir);

            await executor.execute(makeChatTask(groupId, 'task-persist'), 'Hello');

            const turns = store.processes.get(toQueueProcessId('task-persist'))!.conversationTurns!;
            expect(turns[0].repoGroupContext).toBe(expectedBlock());
            // The transcript still shows exactly what the user typed.
            expect(turns[0].content).toBe('Hello');
        });

        it('records only live members on the user turn', async () => {
            await store.removeWorkspace('ws-v2-bbb');
            seedFirstTurnProcess(groupId, 'task-persist-stale');
            const executor = new ChatExecutor(store, makeOptions(), tmpDir);

            await executor.execute(makeChatTask(groupId, 'task-persist-stale'), 'Hello');

            const turns = store.processes.get(toQueueProcessId('task-persist-stale'))!.conversationTurns!;
            expect(turns[0].repoGroupContext).toContain(`- Repo A: ${repoA}`);
            expect(turns[0].repoGroupContext).not.toContain('Repo B');
        });

        it('records nothing on the user turn for a non-group workspace', async () => {
            seedFirstTurnProcess('ws-v2-aaa', 'task-persist-plain');
            const executor = new ChatExecutor(store, makeOptions(), tmpDir);

            await executor.execute(makeChatTask('ws-v2-aaa', 'task-persist-plain'), 'Hello');

            const turns = store.processes.get(toQueueProcessId('task-persist-plain'))!.conversationTurns!;
            expect(turns[0].repoGroupContext).toBeUndefined();
        });
    });

    describe('follow-up turn (FollowUpExecutor.executeFollowUp)', () => {
        function seedProcess(workspaceId: string, id = 'proc-1'): AIProcess {
            const process: AIProcess = {
                id,
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                promptPreview: 'initial prompt',
                sdkSessionId: 'sess-1',
                workingDirectory: path.join(tmpDir, 'repos', workspaceId),
                conversationTurns: [
                    { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
                    { role: 'assistant', content: 'Hi', timestamp: new Date(), turnIndex: 1, timeline: [] },
                ],
                metadata: { type: 'chat', workspaceId, provider: 'copilot', mode: 'ask' },
            };
            store.processes.set(id, process);
            return process;
        }

        it('appends the member block to the follow-up message and passes additionalDirectories', async () => {
            seedProcess(groupId, 'proc-group');
            const executor = new FollowUpExecutor(store, makeOptions(), tmpDir);

            await executor.executeFollowUp('proc-group', 'next question', undefined, 'ask');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).toBe(`next question\n\n${expectedBlock()}`);
            expect(call.additionalDirectories).toEqual([repoA, repoB]);
        });

        it('skips stale members on follow-ups too', async () => {
            await store.removeWorkspace('ws-v2-aaa');
            seedProcess(groupId, 'proc-group-stale');
            const executor = new FollowUpExecutor(store, makeOptions(), tmpDir);

            await executor.executeFollowUp('proc-group-stale', 'next question', undefined, 'ask');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).not.toContain('Repo A');
            expect(call.additionalDirectories).toEqual([repoB]);
        });

        it('records the injected block on the newest user turn', async () => {
            const process = seedProcess(groupId, 'proc-persist');
            // The POST /message route persists the user turn before dispatch.
            process.conversationTurns!.push({
                role: 'user', content: 'next question', timestamp: new Date(), turnIndex: 2, timeline: [],
            });
            const executor = new FollowUpExecutor(store, makeOptions(), tmpDir);

            await executor.executeFollowUp('proc-persist', 'next question', undefined, 'ask');

            const turns = store.processes.get('proc-persist')!.conversationTurns!;
            expect(turns[2].repoGroupContext).toBe(expectedBlock());
            expect(turns[2].content).toBe('next question');
            // Earlier turns keep whatever they were injected with (nothing here).
            expect(turns[0].repoGroupContext).toBeUndefined();
        });

        it('records only live members on the follow-up user turn', async () => {
            await store.removeWorkspace('ws-v2-aaa');
            const process = seedProcess(groupId, 'proc-persist-stale');
            process.conversationTurns!.push({
                role: 'user', content: 'next question', timestamp: new Date(), turnIndex: 2, timeline: [],
            });
            const executor = new FollowUpExecutor(store, makeOptions(), tmpDir);

            await executor.executeFollowUp('proc-persist-stale', 'next question', undefined, 'ask');

            const turns = store.processes.get('proc-persist-stale')!.conversationTurns!;
            expect(turns[2].repoGroupContext).toContain(`- Repo B: ${repoB}`);
            expect(turns[2].repoGroupContext).not.toContain('Repo A');
        });

        it('records nothing on the user turn for a non-group follow-up', async () => {
            const process = seedProcess('ws-v2-aaa', 'proc-persist-plain');
            process.conversationTurns!.push({
                role: 'user', content: 'next question', timestamp: new Date(), turnIndex: 2, timeline: [],
            });
            const executor = new FollowUpExecutor(store, makeOptions(), tmpDir);

            await executor.executeFollowUp('proc-persist-plain', 'next question', undefined, 'ask');

            const turns = store.processes.get('proc-persist-plain')!.conversationTurns!;
            expect(turns[2].repoGroupContext).toBeUndefined();
        });

        it('injects nothing for a non-group follow-up', async () => {
            seedProcess('ws-v2-aaa', 'proc-plain');
            const executor = new FollowUpExecutor(store, makeOptions(), tmpDir);

            await executor.executeFollowUp('proc-plain', 'next question', undefined, 'ask');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).toBe('next question');
            expect(call.additionalDirectories).toBeUndefined();
        });
    });
});
