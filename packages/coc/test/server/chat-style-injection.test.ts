/**
 * Chat-style injection rule (AC-04 / AC-05 / AC-06).
 *
 * The style block rides the *user message*: it is prepended before the message
 * is persisted, so the transcript shows it, and it is emitted only when the
 * style selected for a turn differs from the style last recorded for the
 * conversation and is not `'default'`.
 *
 * Covers both halves of the rule:
 *  - turn 1, via ProcessLifecycleRunner (new conversation, recorded style is
 *    implicitly `'default'`),
 *  - every later turn, via POST /api/processes/:id/message.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import type { ChatStyle } from '@plusplusoneplusplus/coc-client';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import { buildChatStyleBlock } from '../../src/server/executors/chat-style-prompt';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from './helpers/mock-process-store';

const HUMAN_BLOCK = buildChatStyleBlock('human')!;
const DIRECT_BLOCK = buildChatStyleBlock('direct')!;

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

    async function runTask(task: QueuedTask, flagEnabled = true, configuredDefault?: ChatStyle) {
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
        expect(process?.conversationTurns?.[0]?.content).toBe(`${HUMAN_BLOCK}\n\nWhat broke the build?`);
        expect(executedPrompt).toBe(`${HUMAN_BLOCK}\n\nWhat broke the build?`);
        expect(process?.metadata?.chatStyle).toBe('human');
    });

    it('injects nothing on Default and stores the message byte-for-byte', async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-default', 'default'));

        expect(process?.conversationTurns?.[0]?.content).toBe('What broke the build?');
        expect(executedPrompt).toBe('What broke the build?');
        expect(process?.conversationTurns?.[0]?.content).not.toContain('<chat-style>');
        // Default is a real recorded state, not a gap.
        expect(process?.metadata?.chatStyle).toBe('default');
    });

    it('treats an omitted style as Default when no server default is configured', async () => {
        const { process } = await runTask(chatTask('t-omitted', undefined));

        expect(process?.conversationTurns?.[0]?.content).toBe('What broke the build?');
        expect(process?.metadata?.chatStyle).toBe('default');
    });

    // features.defaultChatStyle — the omitted-field path is the whole point:
    // API callers and older clients send nothing and must still get the
    // admin's choice, block and all, on turn 1.
    it('applies the configured server default when the request carries no style', async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-cfg-direct', undefined), true, 'direct');

        expect(process?.conversationTurns?.[0]?.content).toBe(`${DIRECT_BLOCK}\n\nWhat broke the build?`);
        expect(executedPrompt).toBe(`${DIRECT_BLOCK}\n\nWhat broke the build?`);
        expect(process?.metadata?.chatStyle).toBe('direct');
    });

    it("lets an explicit 'default' beat a configured server default", async () => {
        const { process, executedPrompt } = await runTask(chatTask('t-cfg-explicit', 'default'), true, 'direct');

        expect(process?.conversationTurns?.[0]?.content).toBe('What broke the build?');
        expect(executedPrompt).not.toContain('<chat-style>');
        expect(process?.metadata?.chatStyle).toBe('default');
    });

    it('lets an explicit style beat a configured server default', async () => {
        const { process } = await runTask(chatTask('t-cfg-human', 'human'), true, 'direct');

        expect(process?.conversationTurns?.[0]?.content).toBe(`${HUMAN_BLOCK}\n\nWhat broke the build?`);
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

        expect(process?.conversationTurns?.[0]?.content).toBe('What broke the build?');
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

    it('injects only when the style differs from the recorded one', async () => {
        await startServer();
        await seedProcess('p-seq', { chatStyle: 'default' });

        await sendTurn('p-seq', 'one', 'default');
        await sendTurn('p-seq', 'two', 'human');
        await sendTurn('p-seq', 'three', 'human');
        await sendTurn('p-seq', 'four', 'direct');
        await sendTurn('p-seq', 'five', 'default');
        await sendTurn('p-seq', 'six', 'human');

        expect(await userTurns('p-seq')).toEqual([
            'one',
            `${HUMAN_BLOCK}\n\ntwo`,
            'three',
            `${DIRECT_BLOCK}\n\nfour`,
            'five',
            `${HUMAN_BLOCK}\n\nsix`,
        ]);
        // Switching back to Default still records it — Default is a state.
        expect((await store.getProcess('p-seq'))?.metadata?.chatStyle).toBe('human');
    });

    it('records the style on every turn, including turns that inject nothing', async () => {
        await startServer();
        await seedProcess('p-record', { chatStyle: 'direct' });

        await sendTurn('p-record', 'switch off', 'default');

        expect((await store.getProcess('p-record'))?.metadata?.chatStyle).toBe('default');
        expect(await userTurns('p-record')).toEqual(['switch off']);
    });

    it('leaves a conversation that stays on Default byte-identical', async () => {
        await startServer();
        await seedProcess('p-default');

        await sendTurn('p-default', 'first');
        await sendTurn('p-default', 'second', 'default');
        await sendTurn('p-default', 'third');

        const turns = await userTurns('p-default');
        expect(turns).toEqual(['first', 'second', 'third']);
        expect(turns.join('\n')).not.toContain('<chat-style>');
    });

    it('injects nothing and records nothing when the admin flag is off', async () => {
        flagEnabled = false;
        await startServer();
        await seedProcess('p-off');

        await sendTurn('p-off', 'hello', 'human');

        expect(await userTurns('p-off')).toEqual(['hello']);
        expect((await store.getProcess('p-off'))?.metadata?.chatStyle).toBeUndefined();
    });

    it('never injects into a Ralph conversation', async () => {
        await startServer();
        await seedProcess('p-ralph', { mode: 'ralph' });

        await sendTurn('p-ralph', 'keep going', 'human');

        expect(await userTurns('p-ralph')).toEqual(['keep going']);
        expect((await store.getProcess('p-ralph'))?.metadata?.chatStyle).toBeUndefined();
    });

    // A follow-up with no chatStyle field lands on the configured server
    // default, so a client that never learned about the selector still tracks
    // whatever the admin picked.
    it('falls back to the configured server default when a follow-up omits the style', async () => {
        followUpDefaultChatStyle = 'direct';
        await startServer();
        await seedProcess('p-cfg');

        await sendTurn('p-cfg', 'hello');

        expect(await userTurns('p-cfg')).toEqual([`${DIRECT_BLOCK}\n\nhello`]);
        expect((await store.getProcess('p-cfg'))?.metadata?.chatStyle).toBe('direct');
    });

    it("lets an explicit 'default' follow-up beat the configured server default", async () => {
        followUpDefaultChatStyle = 'direct';
        await startServer();
        await seedProcess('p-cfg-explicit');

        await sendTurn('p-cfg-explicit', 'hello', 'default');

        expect(await userTurns('p-cfg-explicit')).toEqual(['hello']);
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
