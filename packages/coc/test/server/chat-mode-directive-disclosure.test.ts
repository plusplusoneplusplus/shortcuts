/**
 * Mode-directive disclosure.
 *
 * The mode directive rides the *user message* (it is no longer a system-prompt
 * block), so the transcript shows it: it is prepended before the turn is
 * persisted, exactly like the `<chat-style>` block, and the chat bubble renders
 * what the model was actually told.
 *
 * Covers both halves:
 *  - turn 1, via ProcessLifecycleRunner, including the executors that send no
 *    directive and therefore must disclose none,
 *  - every later turn, via POST /api/processes/:id/message.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../src/server/executors/process-lifecycle-runner';
import {
    MODE_SWITCHED_TO_AUTOPILOT_NOTE,
    buildChatModeDisplayBlock,
} from '../../src/server/executors/chat-mode-directive';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from './helpers/mock-process-store';

const ASK_BLOCK = buildChatModeDisplayBlock({ mode: 'ask' })!;

// ============================================================================
// Turn 1 — ProcessLifecycleRunner
// ============================================================================

describe('mode directive disclosure on the first turn', () => {
    function task(id: string, payload: Record<string, unknown>): QueuedTask {
        return {
            id,
            repoId: 'ws-mode',
            type: (payload.kind as string) === 'pr-classification' ? 'pr-classification' : 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.parse('2026-09-02T00:00:00.000Z'),
            payload,
            config: {},
            displayName: 'Turn one',
        } as unknown as QueuedTask;
    }

    async function runTask(t: QueuedTask) {
        const store = createMockProcessStore();
        let executedPrompt: string | undefined;
        const runner = new ProcessLifecycleRunner(store, undefined, () => undefined, 'claude');
        await runner.run(t, {
            cancelledTasks: new Set(),
            executeFollowUpFn: async () => undefined,
            executeByTypeFn: async (_t, prompt) => {
                executedPrompt = prompt;
                return { response: 'done.' };
            },
            getWorkingDirectoryFn: () => undefined,
        });
        const process = await store.getProcess(`queue_${t.id}`);
        return { process, executedPrompt };
    }

    it('opens an ask-mode turn with the read-only block and keeps the message intact', async () => {
        const { process } = await runTask(task('m-ask', {
            kind: 'chat',
            mode: 'ask',
            prompt: 'What broke the build?',
        }));

        expect(process?.conversationTurns?.[0]?.content).toBe(`${ASK_BLOCK}\n\nWhat broke the build?`);
    });

    it('keeps the injected block out of the preview and the recorded full prompt', async () => {
        // These drive the chat list and the AI title; they record what the user
        // asked, and the directive would swamp both.
        const { process } = await runTask(task('m-preview', {
            kind: 'chat',
            mode: 'ask',
            prompt: 'What broke the build?',
        }));

        expect(process?.promptPreview).toBe('What broke the build?');
        expect(process?.fullPrompt).toBe('What broke the build?');
    });

    it('discloses nothing for a fresh autopilot chat — nothing was injected', async () => {
        const { process } = await runTask(task('m-auto', {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Do it',
        }));

        expect(process?.conversationTurns?.[0]?.content).toBe('Do it');
    });

    it.each([
        ['note chat', { context: { noteChat: { notePath: 'Notes/a.md' } } }],
        ['note create', { context: { noteCreate: { root: 'Notes' } } }],
        ['task generation', { context: { taskGeneration: { workspaceId: 'ws-mode' } } }],
        ['multi-file resolve comments', { context: { resolveDiffCommentsMulti: true } }],
        ['ralph', { mode: 'ralph' }],
    ])('discloses nothing for %s — that executor sends no directive', async (label, extra) => {
        // Over-claiming here would show the model a constraint in the transcript
        // that it was never given.
        const { process } = await runTask(task(`m-${label.replace(/\s+/g, '-')}`, {
            kind: 'chat',
            mode: 'ask',
            prompt: 'Turn one',
            ...extra,
        }));

        expect(process?.conversationTurns?.[0]?.content).toBe('Turn one');
    });

    it('discloses ask for the executors that hardcode it, whatever the payload mode says', async () => {
        const { process } = await runTask(task('m-commit', {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Review this commit',
            context: { commitChat: { sha: 'abc123' } },
        }));

        // extractPrompt also prefixes the commit context, so this asserts the
        // block's position rather than the whole string.
        expect(process?.conversationTurns?.[0]?.content?.startsWith(ASK_BLOCK)).toBe(true);
        expect(process?.conversationTurns?.[0]?.content?.endsWith('Review this commit')).toBe(true);
    });
});

// ============================================================================
// Later turns — POST /api/processes/:id/message
// ============================================================================

describe('mode directive disclosure on follow-up turns', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;
    let mockBridge: QueueExecutorBridge;

    async function startServer() {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-directive-followup-'));
        store = new FileProcessStore({ dataDir });
        mockBridge = createMockBridge();

        const routes: Route[] = [];
        registerApiRoutes(routes, store, mockBridge, undefined, undefined, undefined, false, () => ({
            excalidrawEnabled: false,
            canvasEnabled: false,
            kustoEnabled: false,
            chatStyleSelectorEnabled: false,
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
    async function sendTurn(id: string, content: string, mode?: string) {
        const res = await postMessage(id, { content, ...(mode ? { mode } : {}) });
        expect(res.status).toBe(202);
        await store.updateProcess(id, { status: 'completed' });
    }

    async function userTurns(id: string): Promise<string[]> {
        const proc = await store.getProcess(id);
        return (proc?.conversationTurns ?? []).filter(t => t.role === 'user').map(t => t.content);
    }

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('discloses the block on every ask follow-up', async () => {
        await startServer();
        await seedProcess('p-ask');

        await sendTurn('p-ask', 'first');
        await sendTurn('p-ask', 'second');

        expect(await userTurns('p-ask')).toEqual([
            `${ASK_BLOCK}\n\nfirst`,
            `${ASK_BLOCK}\n\nsecond`,
        ]);
    });

    it('discloses the transition note on the turn that leaves ask mode', async () => {
        await startServer();
        await seedProcess('p-switch');

        await sendTurn('p-switch', 'now go do it', 'autopilot');

        const turns = await userTurns('p-switch');
        expect(turns[0]).toContain(MODE_SWITCHED_TO_AUTOPILOT_NOTE);
        expect(turns[0]).not.toContain('<coc-read-only-mode>');
        expect(turns[0].endsWith('now go do it')).toBe(true);
    });

    it('stores an autopilot conversation byte-for-byte once it has settled', async () => {
        await startServer();
        await seedProcess('p-auto', { mode: 'autopilot' });

        await sendTurn('p-auto', 'keep going', 'autopilot');

        expect(await userTurns('p-auto')).toEqual(['keep going']);
    });

    it('re-discloses the block when a conversation switches back to ask', async () => {
        await startServer();
        await seedProcess('p-back', { mode: 'autopilot' });

        await sendTurn('p-back', 'explain this', 'ask');

        expect(await userTurns('p-back')).toEqual([`${ASK_BLOCK}\n\nexplain this`]);
    });
});
