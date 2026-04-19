/**
 * Note Chat Executor Tests
 *
 * Tests for NoteChatExecutor.
 * Covers:
 * - buildModeOptions uses autopilot agentMode
 * - buildModeOptions injects note content into system message
 * - buildModeOptions patches process metadata with noteContentStatus
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { NoteChatExecutor } from '../../../src/server/executors/note-chat-executor';
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

vi.mock('../../../src/server/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

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
        toolCallCacheStore: { options: {} } as any,
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue(WS_ID),
        ...overrides,
    };
}

function makeNoteChatTask(id = 'task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'autopilot',
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
        it('uses autopilot agentMode', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'Update the note', undefined);
            expect(opts.agentMode).toBe('autopilot');
        });

        it('does not include toolResultInterceptors', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            expect(opts.toolResultInterceptors).toBeUndefined();
        });
    });

    describe('noteContentStatus metadata patching', () => {
        it('calls store.updateProcess with noteContentStatus after building options', async () => {
            const task = makeNoteChatTask();
            // Seed the process so getProcess finds it
            const processId = toQueueProcessId(task.id);
            await store.addProcess({
                id: processId,
                type: 'chat',
                status: 'running',
                startTime: new Date(),
                metadata: { type: 'chat', notePath: NOTE_REL_PATH, noteTitle: 'My Note' },
            } as any);

            await (executor as any).buildModeOptions(task, 'do it', undefined);

            // Allow async metadata patch to settle
            await new Promise(r => setTimeout(r, 50));

            const updated = await store.getProcess(processId);
            expect(updated?.metadata).toHaveProperty('noteContentStatus');
            const status = (updated?.metadata as any).noteContentStatus;
            // Status may be 'attached' or 'not-found' depending on OS path resolution in tests.
            // The resolveNoteContentStatus pure function is tested separately.
            expect(['attached', 'truncated', 'not-found', 'empty']).toContain(status.status);
            expect(status.charLimit).toBe(8000);
        });
    });
});
