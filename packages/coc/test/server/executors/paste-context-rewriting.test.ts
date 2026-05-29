/**
 * Paste Context Rewriting Integration Tests
 *
 * Tests that ChatBaseExecutor rewrites large prompts to file-path references
 * and cleans up temp files after execution.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { PASTE_THRESHOLD } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

// Mock resolveSkill from forge to avoid real filesystem calls, but keep rewriteLargePrompt real
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        resolveSkill: vi.fn(),
    };
});

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function makeOptions(
    store: ReturnType<typeof createMockProcessStore>,
    overrides?: Partial<ChatModeExecutorOptions>,
): ChatModeExecutorOptions {
    return {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        ...overrides,
    };
}

function makeChatTaskWithWorkspace(
    prompt: string,
    workspaceId: string,
    mode: 'ask' | 'autopilot' = 'autopilot',
    id = 'task-paste-1',
): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode,
            prompt,
            workspaceId,
        },
        config: {},
        displayName: prompt.slice(0, 40),
    };
}

function largeText(size: number, char = 'x'): string {
    return char.repeat(size);
}

// ============================================================================
// Tests
// ============================================================================

describe('paste-context rewriting in ChatBaseExecutor', () => {
    let dataDir: string;
    const workspaceId = 'paste-test-ws';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-exec-test-'));
        fs.mkdirSync(path.join(dataDir, 'repos', workspaceId), { recursive: true });
        sdkMocks.resetAll();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('rewrites large prompts to file-path references for autopilot mode', async () => {
        const store = createMockProcessStore();
        const executor = new AutopilotExecutor(store, makeOptions(store), dataDir);

        const largePrompt = largeText(PASTE_THRESHOLD + 500);
        const task = makeChatTaskWithWorkspace(largePrompt, workspaceId);

        await executor.execute(task, largePrompt);

        // Verify the AI was called with a rewritten prompt (not the original large text)
        const sentPrompt = sdkMocks.mockSendMessage.mock.calls[0][0].prompt;
        expect(sentPrompt.length).toBeLessThan(largePrompt.length);
        expect(sentPrompt).toContain('saved to:');
        expect(sentPrompt).toContain('paste-context');
        expect(sentPrompt).toMatch(/approximately \d+ characters/);
    });

    it('does not rewrite prompts under the threshold', async () => {
        const store = createMockProcessStore();
        const executor = new AutopilotExecutor(store, makeOptions(store), dataDir);

        const shortPrompt = 'A short prompt that is well under the threshold';
        const task = makeChatTaskWithWorkspace(shortPrompt, workspaceId);

        await executor.execute(task, shortPrompt);

        // Verify the original prompt was passed through (not rewritten to a file reference)
        const sentPrompt = sdkMocks.mockSendMessage.mock.calls[0][0].prompt;
        expect(sentPrompt).toContain(shortPrompt);
        expect(sentPrompt).not.toContain('saved to:');
        expect(sentPrompt).not.toContain('paste-context');
    });

    it('cleans up paste temp file after successful execution', async () => {
        const store = createMockProcessStore();
        const executor = new AutopilotExecutor(store, makeOptions(store), dataDir);

        const largePrompt = largeText(PASTE_THRESHOLD + 100);
        const task = makeChatTaskWithWorkspace(largePrompt, workspaceId);

        await executor.execute(task, largePrompt);

        // Extract file path from the prompt that was sent to AI
        const sentPrompt = sdkMocks.mockSendMessage.mock.calls[0][0].prompt as string;
        const match = sentPrompt.match(/saved to: (.+)/);
        expect(match).toBeTruthy();
        const filePath = match![1];

        // File should be cleaned up after execution
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('cleans up paste temp file after failed execution', async () => {
        const store = createMockProcessStore();
        const failingSdk = createMockSDKService({
            sendMessageResponse: { success: false, error: 'AI failed' },
        });
        const executor = new AutopilotExecutor(store, {
            ...makeOptions(store),
            aiService: failingSdk.service as any,
        }, dataDir);

        const largePrompt = largeText(PASTE_THRESHOLD + 100);
        const task = makeChatTaskWithWorkspace(largePrompt, workspaceId);

        let savedFilePath: string | undefined;
        // Capture the file path before cleanup
        failingSdk.mockSendMessage.mockImplementation(async (opts: any) => {
            const match = opts.prompt.match(/saved to: (.+)/);
            if (match) savedFilePath = match[1];
            return { success: false, error: 'AI failed' };
        });

        await expect(executor.execute(task, largePrompt)).rejects.toThrow('AI failed');

        // File should still be cleaned up in finally block
        if (savedFilePath) {
            expect(fs.existsSync(savedFilePath)).toBe(false);
        }
    });

    it('preserves question prefix when separating from large paste', async () => {
        const store = createMockProcessStore();
        const executor = new AutopilotExecutor(store, makeOptions(store), dataDir);

        const question = 'What is wrong with this log?';
        const largePaste = largeText(PASTE_THRESHOLD + 500);
        const fullPrompt = `${question}\n\n${largePaste}`;
        const task = makeChatTaskWithWorkspace(fullPrompt, workspaceId);

        await executor.execute(task, fullPrompt);

        const sentPrompt = sdkMocks.mockSendMessage.mock.calls[0][0].prompt as string;
        expect(sentPrompt).toContain(question);
        expect(sentPrompt).toContain('saved to:');
        // The large paste should NOT be inline
        expect(sentPrompt).not.toContain(largePaste);
    });

    it('skips rewriting when workspaceId is not present', async () => {
        const store = createMockProcessStore();
        const executor = new AutopilotExecutor(store, makeOptions(store), dataDir);

        const largePrompt = largeText(PASTE_THRESHOLD + 100);
        // Create task WITHOUT workspaceId
        const task: QueuedTask = {
            id: 'task-no-ws',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: largePrompt,
                // No workspaceId!
            },
            config: {},
            displayName: 'No workspace',
        };

        await executor.execute(task, largePrompt);

        // Prompt should pass through unchanged (no workspaceId → no rewriting)
        const sentPrompt = sdkMocks.mockSendMessage.mock.calls[0][0].prompt;
        expect(sentPrompt).toBe(largePrompt);
    });

    it('works with ask mode executor too', async () => {
        const store = createMockProcessStore();
        const executor = new ChatExecutor(store, makeOptions(store), dataDir);

        const largePrompt = largeText(PASTE_THRESHOLD + 500);
        const task = makeChatTaskWithWorkspace(largePrompt, workspaceId, 'ask');

        await executor.execute(task, largePrompt);

        const sentPrompt = sdkMocks.mockSendMessage.mock.calls[0][0].prompt as string;
        expect(sentPrompt.length).toBeLessThan(largePrompt.length);
        expect(sentPrompt).toContain('saved to:');
    });
});
