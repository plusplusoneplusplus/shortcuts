/**
 * Chat-style injection rule (AC-04 / AC-05 / AC-06).
 *
 * The style block rides the *user message*: it is prepended before the message
 * is sent, so the transcript shows it. Initial turns inject non-default styles;
 * follow-up admission carries selection to the executor's context-boundary check.
 *
 * Covers both halves of the rule:
 *  - turn 1, via ProcessLifecycleRunner (new conversation, recorded style is
 *    implicitly `'default'`),
 *  - every later turn, via POST /api/processes/:id/message.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import type { ChatStyle } from '@plusplusoneplusplus/coc-client';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import { buildChatStyleBlock, setChatStylePromptOverridesProvider, shouldInjectChatStyle } from '../../src/server/executors/chat-style-prompt';
import { buildChatModeDisplayBlock } from '../../src/server/executors/chat-mode-directive';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from './helpers/mock-process-store';

const HUMAN_BLOCK = buildChatStyleBlock('human')!;
const DIRECT_BLOCK = buildChatStyleBlock('direct')!;
/** Ask-mode turns also carry the mode directive, stored inside the style block. */
const ASK_BLOCK = buildChatModeDisplayBlock({ mode: 'ask' })!;

/** The stored content of an ask-mode turn: style outermost, then the directive. */
function asked(message: string, styleBlock?: string): string {
    const withMode = `${ASK_BLOCK}\n\n${message}`;
    return styleBlock ? `${styleBlock}\n\n${withMode}` : withMode;
}

// ============================================================================
// Turn 1 — ProcessLifecycleRunner
// ============================================================================

describe('chat style on the first turn of a conversation', () => {
    function chatTask(id: string, chatStyle: string | undefined, overrides: Record<string, unknown> = {}): QueuedTask {
        return {
            id,
            repoId: 'ws-style',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-08-13T00:00:00.000Z'),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'What broke the build?',
                workspaceId: 'ws-style',
                ...(chatStyle !== undefined ? { chatStyle } : {}),
                ...overrides,
            },
            config: {},
            displayName: 'Chat',
        };
    }

    async function runTask(task: QueuedTask, flagEnabled = true, configuredDefault?: ChatStyle, executionError?: Error) {
        const store = createMockProcessStore();
        let executedPrompt: string | undefined;
        const runner = new ProcessLifecycleRunner(
            store,
            undefined,
            () => undefined,
            'claude',
            {
                getChatStyleSelectorEnabled: () => flagEnabled,
                ...(configuredDefault ? { getDefaultChatStyle: () => configuredDefault } : {}),
            },
        );
        const result = await runner.run(task, {
            cancelledTasks: new Set(),
            executeFollowUpFn: async () => undefined,
            executeByTypeFn: async (_t, prompt) => {
                executedPrompt = prompt;
                if (executionError) throw executionError;
                return { response: 'done.' };
            },
            getWorkingDirectoryFn: () => undefined,
        });
        const process = await store.getProcess(`queue_${task.id}`);
        return { result, process, executedPrompt };
    }

    it('injects the block and records the style when the user picked a real style', async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-human', 'human'));

        // AC-05 — the persisted user message opens with the block.
        expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?', HUMAN_BLOCK));
        expect(executedPrompt).toBe(`${HUMAN_BLOCK}\n\nWhat broke the build?`);
        expect(process?.metadata?.chatStyle).toBe('human');
        expect(process?.metadata?.chatStyleContext).toMatchObject({ style: 'human', block: HUMAN_BLOCK, turnIndex: 0 });
    });

    it('does not establish context when initial execution fails', async () => {
        const { result, process } = await runTask(chatTask('t-failed', 'human'), true, undefined, new Error('Delivery failed'));
        expect(result.success).toBe(false);
        expect(process?.metadata?.chatStyleContext).toBeUndefined();
    });

    it('records the actual initial turn index when cold resume prepends historical turns', async () => {
        const store = createMockProcessStore();
        await store.addProcess({
            id: 'history', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'history',
            metadata: { workspaceId: 'ws-style' },
            conversationTurns: [
                { role: 'user', content: 'earlier', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'answer', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, 'copilot', {
            getChatStyleSelectorEnabled: () => true,
        });
        const task = chatTask('cold-resume', 'human', { resumedFrom: 'history' });
        expect((await runner.run(task, {
            cancelledTasks: new Set(), executeFollowUpFn: async () => undefined,
            executeByTypeFn: async () => ({ response: 'done', sessionId: 'new-session' }),
            getWorkingDirectoryFn: () => undefined,
        })).success).toBe(true);
        const current = (await store.getProcess('queue_cold-resume'))!;
        expect(current.metadata?.chatStyleContext).toMatchObject({ turnIndex: 2 });
        expect(current.conversationTurns?.[2].content).toBe(asked('What broke the build?', HUMAN_BLOCK));
        expect(shouldInjectChatStyle('human', HUMAN_BLOCK, current, true)).toBe(false);
    });

    // AC-03 — an admin edit to the style's prompt text reaches the injected
    // block on the next chat, without a restart and without changing the
    // 'Selected style:' line.
    it('injects the admin-edited prompt text when an override is configured', async () => {
        setChatStylePromptOverridesProvider(() => ({ human: 'SENTINEL-HUMAN-PROMPT' }));
        try {
            const { process, executedPrompt } = await runTask(chatTask('t-human-override', 'human'));

            const expected = ['<chat-style>', 'Selected style: Human.', 'SENTINEL-HUMAN-PROMPT', '</chat-style>'].join('\n');
            expect(executedPrompt).toBe(`${expected}\n\nWhat broke the build?`);
            expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?', expected));
            expect(process?.metadata?.chatStyle).toBe('human');
        } finally {
            setChatStylePromptOverridesProvider(undefined);
        }
    });

    // The other half of the same rule: with no override the block must be
    // byte-for-byte what it was before overrides existed.
    it('injects the built-in block when the override map is empty', async () => {
        setChatStylePromptOverridesProvider(() => ({}));
        try {
            const { executedPrompt } = await runTask(chatTask('t-human-no-override', 'human'));
            expect(executedPrompt).toBe(`${HUMAN_BLOCK}\n\nWhat broke the build?`);
        } finally {
            setChatStylePromptOverridesProvider(undefined);
        }
    });

    it('injects nothing on Default and stores the message byte-for-byte', async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-default', 'default'));

        expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?'));
        expect(executedPrompt).toBe('What broke the build?');
        expect(process?.conversationTurns?.[0]?.content).not.toContain('<chat-style>');
        // Default is a real recorded state, not a gap.
        expect(process?.metadata?.chatStyle).toBe('default');
    });

    it('treats an omitted style as Default when no server default is configured', async () => {
        const { process } = await runTask(chatTask('t-omitted', undefined));

        expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?'));
        expect(process?.metadata?.chatStyle).toBe('default');
    });

    // features.defaultChatStyle — the omitted-field path is the whole point:
    // API callers and older clients send nothing and must still get the
    // admin's choice, block and all, on turn 1.
    it('applies the configured server default when the request carries no style', async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-cfg-direct', undefined), true, 'direct');

        expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?', DIRECT_BLOCK));
        expect(executedPrompt).toBe(`${DIRECT_BLOCK}\n\nWhat broke the build?`);
        expect(process?.metadata?.chatStyle).toBe('direct');
    });

    it("lets an explicit 'default' beat a configured server default", async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-cfg-explicit', 'default'), true, 'direct');

        expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?'));
        expect(executedPrompt).not.toContain('<chat-style>');
        expect(process?.metadata?.chatStyle).toBe('default');
    });

    it('lets an explicit style beat a configured server default', async () => {
        const { process } = await runTask(chatTask('t-cfg-human', 'human'), true, 'direct');

        expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?', HUMAN_BLOCK));
        expect(process?.metadata?.chatStyle).toBe('human');
    });

    it('ignores the configured server default when the admin flag is off', async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-cfg-off', undefined), false, 'direct');

        expect(executedPrompt).toBe('What broke the build?');
        expect(process?.metadata?.chatStyle).toBeUndefined();
    });

    it('ignores the configured server default for an out-of-scope executor (Ralph)', async () => {
        const { process, executedPrompt } = await runTask(
            chatTask('t-cfg-ralph', undefined, { mode: 'ralph' }),
            true,
            'direct',
        );

        expect(executedPrompt).toBe('What broke the build?');
        expect(process?.metadata?.chatStyle).toBeUndefined();
    });

    it('injects nothing and records nothing when the admin flag is off', async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-flag-off', 'human'), false);

        expect(process?.conversationTurns?.[0]?.content).toBe(asked('What broke the build?'));
        expect(executedPrompt).toBe('What broke the build?');
        expect(process?.metadata?.chatStyle).toBeUndefined();
    });

    it('never injects for an out-of-scope executor (Ralph)', async () => {
        const { process, executedPrompt } = await runTask(
            chatTask('t-ralph', 'human', { mode: 'ralph' }),
        );

        expect(process?.conversationTurns?.[0]?.content).toBe('What broke the build?');
        expect(executedPrompt).toBe('What broke the build?');
        expect(process?.metadata?.chatStyle).toBeUndefined();
    });

    it.each([
        { taskGeneration: {} },
        { replication: {} },
        { resolveComments: {} },
        { resolveDiffCommentsMulti: {} },
        { classifyDiff: { repoId: 'workspace', prId: '1', headSha: 'head' } },
        { noteCreate: {} },
    ])('keeps specialized initial context %j out of style injection', async context => {
        const { process, executedPrompt } = await runTask(chatTask('t-specialized', 'human', { context }));
        expect(executedPrompt).not.toContain('<chat-style>');
        expect(process?.metadata?.chatStyle).toBeUndefined();
        expect(process?.metadata?.chatStyleContext).toBeUndefined();
    });

    it.each(['commitChat', 'noteChat'])('keeps %s initial chats eligible', async name => {
        const { process, executedPrompt } = await runTask(chatTask('t-artifact', 'human', { context: { [name]: {} } }));
        expect(executedPrompt).toContain(HUMAN_BLOCK);
        expect(process?.metadata?.chatStyle).toBe('human');
    });

    it('excludes Dreams internal chat-shaped tasks by task type', async () => {
        const task = chatTask('t-dream', 'human');
        task.type = 'dream';
        const { process, executedPrompt } = await runTask(task);
        expect(executedPrompt).not.toContain('<chat-style>');
        expect(process?.metadata?.chatStyle).toBeUndefined();
        expect(process?.metadata?.chatStyleContext).toBeUndefined();
    });

    it('never injects for a workflow task', async () => {
        const task: QueuedTask = {
            id: 't-workflow',
            repoId: 'ws-style',
            type: 'run-workflow',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-08-13T00:00:00.000Z'),
            payload: {
                kind: 'run-workflow',
                workflowPath: '/tmp/example.workflow.js',
                workspaceId: 'ws-style',
                chatStyle: 'human',
            },
            config: {},
            displayName: 'Run Workflow',
        };

        const { process } = await runTask(task);

        expect(process?.metadata?.chatStyle).toBeUndefined();
    });
});

// ============================================================================
// Later turns — POST /api/processes/:id/message
// ============================================================================

describe('chat style on follow-up turns', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;
    let mockBridge: QueueExecutorBridge;
    let flagEnabled: boolean;
    let followUpDefaultChatStyle: ChatStyle;

    async function startServer() {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-style-followup-'));
        store = new FileProcessStore({ dataDir });
        mockBridge = createMockBridge();

        const routes: Route[] = [];
        registerApiRoutes(routes, store, mockBridge, undefined, undefined, undefined, false, () => ({
            excalidrawEnabled: false,
            canvasEnabled: false,
            kustoEnabled: false,
            chatStyleSelectorEnabled: flagEnabled,
            chatProviderSwitchingEnabled: false,
            defaultChatStyle: followUpDefaultChatStyle,
        }));

        const handler = createRequestHandler({ routes, spaHtml: generateDashboardHtml(), store });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`;
    }

    function postMessage(id: string, body: unknown): Promise<{ status: number; body: string }> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(`${baseUrl}/api/processes/${id}/message`);
            const req = http.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port,
                    path: parsed.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c: Buffer) => chunks.push(c));
                    res.on('end', () => resolve({
                        status: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    }));
                },
            );
            req.on('error', reject);
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async function seedProcess(id: string, metadata: Record<string, unknown> = {}) {
        const proc: AIProcess = {
            id,
            type: 'clarification',
            promptPreview: 'seed',
            fullPrompt: 'seed',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: `sess-${id}`,
            conversationTurns: [],
            metadata: { type: 'chat', mode: 'ask', ...metadata },
        } as AIProcess;
        await store.addProcess(proc);
    }

    /** Send a turn, then reset the process to 'completed' so the next one is accepted. */
    async function sendTurn(id: string, content: string, chatStyle?: string) {
        const res = await postMessage(id, { content, ...(chatStyle ? { chatStyle } : {}) });
        expect(res.status).toBe(202);
        await store.updateProcess(id, { status: 'completed' });
    }

    async function userTurns(id: string): Promise<string[]> {
        const proc = await store.getProcess(id);
        return (proc?.conversationTurns ?? []).filter(t => t.role === 'user').map(t => t.content);
    }

    beforeEach(() => {
        flagEnabled = true;
        followUpDefaultChatStyle = 'default';
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('carries every accepted selection to execution without decorating admission content', async () => {
        await startServer();
        await seedProcess('p-seq', { chatStyle: 'default' });

        await sendTurn('p-seq', 'one', 'default');
        await sendTurn('p-seq', 'two', 'human');
        await sendTurn('p-seq', 'three', 'human');
        await sendTurn('p-seq', 'four', 'direct');
        await sendTurn('p-seq', 'five', 'default');
        await sendTurn('p-seq', 'six', 'human');

        expect(await userTurns('p-seq')).toEqual([
            asked('one'),
            asked('two'),
            asked('three'),
            asked('four'),
            asked('five'),
            asked('six'),
        ]);
        expect(vi.mocked(mockBridge.enqueue!).mock.calls.map(([task]) => task.payload.chatStyle))
            .toEqual(['default', 'human', 'human', 'direct', 'default', 'human']);
        expect(vi.mocked(mockBridge.enqueue!).mock.calls.every(([task]) =>
            !String(task.payload.prompt).includes('<chat-style>'))).toBe(true);
        // Switching back to Default still records it — Default is a state.
        expect((await store.getProcess('p-seq'))?.metadata?.chatStyle).toBe('human');
    });

    it('records the style on every turn, including turns that inject nothing', async () => {
        await startServer();
        await seedProcess('p-record', { chatStyle: 'direct' });

        await sendTurn('p-record', 'switch off', 'default');

        expect((await store.getProcess('p-record'))?.metadata?.chatStyle).toBe('default');
        expect(await userTurns('p-record')).toEqual([asked('switch off')]);
    });

    it('leaves a conversation that stays on Default byte-identical', async () => {
        await startServer();
        await seedProcess('p-default');

        await sendTurn('p-default', 'first');
        await sendTurn('p-default', 'second', 'default');
        await sendTurn('p-default', 'third');

        const turns = await userTurns('p-default');
        expect(turns).toEqual([asked('first'), asked('second'), asked('third')]);
        expect(turns.join('\n')).not.toContain('<chat-style>');
    });

    it('injects nothing and records nothing when the admin flag is off', async () => {
        flagEnabled = false;
        await startServer();
        await seedProcess('p-off');

        await sendTurn('p-off', 'hello', 'human');

        expect(await userTurns('p-off')).toEqual([asked('hello')]);
        expect((await store.getProcess('p-off'))?.metadata?.chatStyle).toBeUndefined();
    });

    it('never injects into a Ralph conversation', async () => {
        await startServer();
        await seedProcess('p-ralph', { mode: 'ralph' });

        await sendTurn('p-ralph', 'keep going', 'human');

        expect(await userTurns('p-ralph')).toEqual(['keep going']);
        expect((await store.getProcess('p-ralph'))?.metadata?.chatStyle).toBeUndefined();
    });

    it('carries the selected style when the accepted turn switches out of Ralph', async () => {
        await startServer();
        await seedProcess('p-leave-ralph', { mode: 'ralph' });
        const result = await postMessage('p-leave-ralph', { content: 'explain', mode: 'ask', chatStyle: 'direct' });
        expect(result.status).toBe(202);
        expect(vi.mocked(mockBridge.enqueue!).mock.calls[0][0].payload).toMatchObject({
            mode: 'ask', chatStyle: 'direct', prompt: 'explain',
        });
    });
    // A follow-up with no chatStyle field lands on the configured server
    // default, so a client that never learned about the selector still tracks
    // whatever the admin picked.
    it('falls back to the configured server default when a follow-up omits the style', async () => {
        followUpDefaultChatStyle = 'direct';
        await startServer();
        await seedProcess('p-cfg');

        await sendTurn('p-cfg', 'hello');

        expect(await userTurns('p-cfg')).toEqual([asked('hello')]);
        expect(vi.mocked(mockBridge.enqueue!).mock.calls[0][0].payload.chatStyle).toBe('direct');
        expect((await store.getProcess('p-cfg'))?.metadata?.chatStyle).toBe('direct');
    });

    it("lets an explicit 'default' follow-up beat the configured server default", async () => {
        followUpDefaultChatStyle = 'direct';
        await startServer();
        await seedProcess('p-cfg-explicit');

        await sendTurn('p-cfg-explicit', 'hello', 'default');

        expect(await userTurns('p-cfg-explicit')).toEqual([asked('hello')]);
        // Unchanged from the conversation's implicit 'default' baseline, so the
        // existing "only an actual change needs a write" rule skips the write.
        expect((await store.getProcess('p-cfg-explicit'))?.metadata?.chatStyle).toBeUndefined();
    });

    it('rejects an unknown style with 400', async () => {
        await startServer();
        await seedProcess('p-bad');

        const res = await postMessage('p-bad', { content: 'hi', chatStyle: 'sassy' });
        expect(res.status).toBe(400);
    });
});
