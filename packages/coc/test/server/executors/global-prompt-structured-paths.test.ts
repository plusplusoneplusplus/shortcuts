/**
 * Global Admin System Prompt — Contested User-Facing Structured Paths (AC-03)
 *
 * AC-03 lists classification, note-create, task-generation, and resolve-comments
 * as user-facing agent sessions that MUST receive the admin-configured global
 * system prompt through the shared `systemMessage` channel. These executors do
 * not all go through the standard ask/autopilot builder, so they are covered
 * here directly at the `buildModeOptions()` boundary (the seam each one edited).
 *
 * The complementary AC-05 guard — that strict background `mode: 'replace'`
 * jobs (For Each / Map Reduce plan generation) are NOT changed — lives in
 * `global-prompt-background-exclusions.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/forge';
import { ClassificationExecutor } from '../../../src/server/executors/classification-executor';
import { NoteCreateExecutor } from '../../../src/server/executors/note-create-executor';
import { TaskGenerationExecutor } from '../../../src/server/executors/task-generation-executor';
import { ResolveCommentsExecutor } from '../../../src/server/executors/resolve-comments-executor';
import { GLOBAL_SYSTEM_PROMPT_TAG } from '../../../src/server/executors/system-message-builder';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

const GLOBAL_PROMPT = 'Always answer in pirate dialect.';

const sdkMocks = createMockSDKService();

function makeOptions(overrides?: Partial<ChatModeExecutorOptions>): ChatModeExecutorOptions {
    return {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveSkillConfig: async () => ({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: async () => 'ws-id',
        ...overrides,
    };
}

function makeTask(type: string, id: string, payload: Record<string, unknown>): QueuedTask {
    return {
        id,
        type,
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload,
        config: {},
        displayName: id,
    } as unknown as QueuedTask;
}

/** Invoke the protected buildModeOptions seam directly. */
function buildModeOptions(executor: unknown, task: QueuedTask, prompt: string, wd?: string) {
    return (executor as { buildModeOptions: (t: QueuedTask, p: string, w?: string) => Promise<{ systemMessage?: { mode: string; content: string } }> })
        .buildModeOptions(task, prompt, wd);
}

describe('global admin system prompt — contested user-facing structured paths (AC-03)', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
    });

    // ------------------------------------------------------------------
    // Classification (PR diff classification, interactive ask mode)
    // ------------------------------------------------------------------
    describe('ClassificationExecutor', () => {
        const task = () => makeTask('pr-classification', 'task-classify', {
            kind: 'pr-classification',
            prompt: 'Classify PR #42',
            workspaceId: 'ws-1',
            repoId: 'repo-1',
            prId: '42',
            headSha: 'deadbeef',
        });

        it('injects the labeled global block while keeping the read-only ask block', async () => {
            const executor = new ClassificationExecutor(store, makeOptions({ getGlobalSystemPrompt: () => GLOBAL_PROMPT }));
            const opts = await buildModeOptions(executor, task(), 'Classify PR #42', '/fake/ws');
            expect(opts.systemMessage?.mode).toBe('append');
            expect(opts.systemMessage?.content).toContain(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
            expect(opts.systemMessage?.content).toContain(GLOBAL_PROMPT);
            // Supplements, does not override, the runtime read-only constraint.
            expect(opts.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
        });

        it('is inert when no global prompt is configured', async () => {
            const executor = new ClassificationExecutor(store, makeOptions());
            const opts = await buildModeOptions(executor, task(), 'Classify PR #42', '/fake/ws');
            expect(opts.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        });
    });

    // ------------------------------------------------------------------
    // Note create (interactive note-tree organization)
    // ------------------------------------------------------------------
    describe('NoteCreateExecutor', () => {
        const task = () => makeTask('chat', 'task-note-create', {
            kind: 'chat',
            mode: 'ask',
            prompt: 'New note',
            workspaceId: 'ws-1',
        });

        it('injects the labeled global block', async () => {
            const executor = new NoteCreateExecutor(store, makeOptions({ getGlobalSystemPrompt: () => GLOBAL_PROMPT }));
            const opts = await buildModeOptions(executor, task(), 'New note');
            expect(opts.systemMessage?.mode).toBe('append');
            expect(opts.systemMessage?.content).toContain(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
            expect(opts.systemMessage?.content).toContain(GLOBAL_PROMPT);
        });

        it('is inert when no global prompt is configured', async () => {
            const executor = new NoteCreateExecutor(store, makeOptions());
            const opts = await buildModeOptions(executor, task(), 'New note');
            expect(opts.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        });
    });

    // ------------------------------------------------------------------
    // Task generation (plan generation; structured but user-facing)
    // ------------------------------------------------------------------
    describe('TaskGenerationExecutor', () => {
        const PLAN_PROMPT = 'PLAN_GENERATION_SYSTEM_PROMPT_CONTRACT';
        const task = () => makeTask('chat', 'task-gen', {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Make a task',
            workspaceId: 'ws-1',
        });

        it('appends the global block AFTER the plan-generation contract', async () => {
            const executor = new TaskGenerationExecutor(store, makeOptions({ getGlobalSystemPrompt: () => GLOBAL_PROMPT }));
            const t = task();
            // buildModeOptions reads the per-task plan prompt populated by execute().
            (executor as unknown as { pendingSystemPrompts: Map<string, string> }).pendingSystemPrompts.set(t.id, PLAN_PROMPT);
            const opts = await buildModeOptions(executor, t, 'Make a task');
            expect(opts.systemMessage?.mode).toBe('append');
            expect(opts.systemMessage?.content).toContain(PLAN_PROMPT);
            expect(opts.systemMessage?.content).toContain(GLOBAL_PROMPT);
            // Order: plan contract first, then the supplementary global block.
            const content = opts.systemMessage!.content;
            expect(content.indexOf(PLAN_PROMPT)).toBeLessThan(content.indexOf(GLOBAL_SYSTEM_PROMPT_TAG));
        });

        it('leaves the structured plan prompt unchanged when no global prompt is set (inert)', async () => {
            const executor = new TaskGenerationExecutor(store, makeOptions());
            const t = task();
            (executor as unknown as { pendingSystemPrompts: Map<string, string> }).pendingSystemPrompts.set(t.id, PLAN_PROMPT);
            const opts = await buildModeOptions(executor, t, 'Make a task');
            expect(opts.systemMessage?.content).toBe(PLAN_PROMPT);
            expect(opts.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        });
    });

    // ------------------------------------------------------------------
    // Resolve comments (single-file interactive + multi-file autopilot)
    // ------------------------------------------------------------------
    describe('ResolveCommentsExecutor', () => {
        const singleFileTask = () => makeTask('chat', 'task-resolve-single', {
            kind: 'chat',
            mode: 'ask',
            prompt: 'Resolve comments',
            workspaceId: 'ws-1',
        });
        const multiFileTask = () => makeTask('chat', 'task-resolve-multi', {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Resolve comments',
            workspaceId: 'ws-1',
            context: { resolveDiffCommentsMulti: true },
        });

        it('injects the global block into single-file (interactive) sessions alongside the ask block', async () => {
            const executor = new ResolveCommentsExecutor(store, makeOptions({ getGlobalSystemPrompt: () => GLOBAL_PROMPT }));
            const opts = await buildModeOptions(executor, singleFileTask(), 'Resolve comments');
            expect(opts.systemMessage?.content).toContain(GLOBAL_PROMPT);
            expect(opts.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
        });

        it('injects the global block into multi-file (autopilot) sessions that previously had no system message', async () => {
            const executor = new ResolveCommentsExecutor(store, makeOptions({ getGlobalSystemPrompt: () => GLOBAL_PROMPT }));
            const opts = await buildModeOptions(executor, multiFileTask(), 'Resolve comments');
            expect(opts.systemMessage?.content).toContain(GLOBAL_PROMPT);
            // Multi-file is autopilot: no read-only directive is added.
            expect(opts.systemMessage?.content ?? '').not.toContain(READ_ONLY_SYSTEM_MESSAGE);
        });

        it('multi-file remains undefined (inert) when no global prompt is configured', async () => {
            const executor = new ResolveCommentsExecutor(store, makeOptions());
            const opts = await buildModeOptions(executor, multiFileTask(), 'Resolve comments');
            expect(opts.systemMessage).toBeUndefined();
        });
    });
});
