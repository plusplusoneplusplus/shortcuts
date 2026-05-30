/**
 * Note Chat Executor Tests
 *
 * Tests for NoteChatExecutor.
 * Covers:
 * - buildModeOptions defaults to interactive (ask) agentMode
 * - buildModeOptions honors payload mode
 * - execute injects note model preference when task has no explicit model
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { NoteChatExecutor } from '../../../src/server/executors/note-chat-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { readRepoPreferences } from '../../../src/server/preferences-handler';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(false),
        promises: {
            ...actual.promises,
            readFile: vi.fn().mockResolvedValue('# My Note\n\nSome content.'),
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../../src/server/preferences-handler', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/preferences-handler')>();
    return {
        ...actual,
        readRepoPreferences: vi.fn().mockReturnValue({}),
        readEffectiveDisabledLlmTools: vi.fn().mockReturnValue(['tavily_web_search']),
    };
});

// ============================================================================
// Helpers
// ============================================================================

const DATA_DIR = path.join('/tmp', 'coc-test-data');
const WS_ID = 'ws-abc123';
const NOTE_REL_PATH = 'my-note.md';

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
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue(WS_ID),
        ...overrides,
    };
}

function makeNoteChatTask(id = 'task-1', mode: string = 'autopilot'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode,
            prompt: 'Update the note',
            workspaceId: WS_ID,
            context: {
                noteChat: {
                    notePath: NOTE_REL_PATH,
                    noteTitle: 'My Note',
                },
            },
        },
        config: {},
        displayName: 'Update the note',
    };
}

// ============================================================================
// Tests — buildModeOptions
// ============================================================================

describe('NoteChatExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: NoteChatExecutor;

    beforeEach(() => {
        store = createMockProcessStore();
        executor = new NoteChatExecutor(store, makeOptions(store), DATA_DIR);
    });

    describe('buildModeOptions', () => {
        it('defaults to interactive (ask) agentMode when mode is missing', async () => {
            const task = makeNoteChatTask('task-no-mode', undefined as any);
            (task.payload as any).mode = undefined;
            const opts = await (executor as any).buildModeOptions(task, 'Ask a question', undefined);
            expect(opts.agentMode).toBe('interactive');
        });

        it('maps ask mode to interactive agentMode', async () => {
            const task = makeNoteChatTask('task-ask', 'ask');
            const opts = await (executor as any).buildModeOptions(task, 'Ask a question', undefined);
            expect(opts.agentMode).toBe('interactive');
        });

        it('maps autopilot mode to autopilot agentMode', async () => {
            const task = makeNoteChatTask('task-auto', 'autopilot');
            const opts = await (executor as any).buildModeOptions(task, 'Update the note', undefined);
            expect(opts.agentMode).toBe('autopilot');
        });

        it('falls back to interactive for unrecognized mode', async () => {
            const task = makeNoteChatTask('task-bad', 'plan');
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            expect(opts.agentMode).toBe('interactive');
        });

        it('does not include toolResultInterceptors', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            expect(opts.toolResultInterceptors).toBeUndefined();
        });
    });

    describe('note model preference', () => {
        const mockReadRepoPrefs = vi.mocked(readRepoPreferences);

        beforeEach(() => {
            mockReadRepoPrefs.mockReset();
            sdkMocks.mockSendMessage.mockReset().mockResolvedValue({
                success: true,
                response: 'AI response text',
                sessionId: 'session-123',
            });
        });

        it('uses claude-sonnet-4.6 as default when no preference is set', async () => {
            mockReadRepoPrefs.mockReturnValue({});
            const task = makeNoteChatTask('task-default', 'autopilot');

            await executor.execute(task, 'Update the note');

            const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
            expect(callArgs.model).toBe('claude-sonnet-4.6');
        });

        it('uses lastModels.note preference when set', async () => {
            mockReadRepoPrefs.mockReturnValue({ lastModels: { note: 'gpt-5.4' } });
            const task = makeNoteChatTask('task-pref', 'autopilot');

            await executor.execute(task, 'Update the note');

            const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
            expect(callArgs.model).toBe('gpt-5.4');
        });

        it('task-level model override takes precedence over note preference', async () => {
            mockReadRepoPrefs.mockReturnValue({ lastModels: { note: 'gpt-5.4' } });
            const task = makeNoteChatTask('task-override', 'autopilot');
            task.config.model = 'explicit-override-model';

            await executor.execute(task, 'Update the note');

            const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
            expect(callArgs.model).toBe('explicit-override-model');
        });

        it('falls back to claude-sonnet-4.6 when lastModels has other modes but not note', async () => {
            mockReadRepoPrefs.mockReturnValue({ lastModels: { task: 'gpt-4', ask: 'claude-3' } });
            const task = makeNoteChatTask('task-fallback', 'autopilot');

            await executor.execute(task, 'Update the note');

            const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
            expect(callArgs.model).toBe('claude-sonnet-4.6');
        });
    });
});
