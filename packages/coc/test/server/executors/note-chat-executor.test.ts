/**
 * Note Chat Executor Tests
 *
 * Tests for NoteChatExecutor and the isNoteFile helper.
 * Covers:
 * - buildModeOptions includes toolResultInterceptors for FILE_EDIT_TOOLS
 * - isNoteFile matches absolute paths
 * - isNoteFile matches paths relative to notesRoot
 * - isNoteFile rejects non-note paths
 * - interceptor emits note-file-edit event for matching paths
 * - interceptor ignores non-note paths
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
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
// notes root mirrors getRepoDataPath(dataDir, wsId, 'notes')
const NOTES_ROOT = path.join(DATA_DIR, 'repos', WS_ID, 'notes');
const ABSOLUTE_NOTE_PATH = path.join(NOTES_ROOT, NOTE_REL_PATH);

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

        it('sets toolResultInterceptors for all edit tools when notePath is set', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            expect(opts.toolResultInterceptors).toBeDefined();
            for (const toolName of ['edit_file', 'str_replace_editor', 'str_replace_based_edit_tool', 'edit', 'apply_patch']) {
                expect(opts.toolResultInterceptors).toHaveProperty(toolName);
                expect(typeof opts.toolResultInterceptors[toolName]).toBe('function');
            }
        });

        it('does not set toolResultInterceptors when notePath is empty', async () => {
            const task: QueuedTask = {
                ...makeNoteChatTask(),
                payload: {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: 'No note',
                    workspaceId: WS_ID,
                    context: { noteChat: { notePath: '', noteTitle: '' } },
                },
            };
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            expect(opts.toolResultInterceptors).toBeUndefined();
        });
    });

    describe('note-file-edit SSE event', () => {
        it('emits note-file-edit when interceptor receives absolute note path', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['edit_file'];
            expect(interceptor).toBeDefined();

            interceptor(
                { path: ABSOLUTE_NOTE_PATH, old_str: 'old text', new_str: 'new text' },
                undefined,
                'tc-001',
            );

            expect(store.emitProcessEvent).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    type: 'note-file-edit',
                    noteFileEdit: expect.objectContaining({
                        toolCallId: 'tc-001',
                        filePath: ABSOLUTE_NOTE_PATH,
                        oldStr: 'old text',
                        newStr: 'new text',
                    }),
                }),
            );
        });

        it('emits note-file-edit when interceptor receives relative note path', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['str_replace_editor'];
            expect(interceptor).toBeDefined();

            interceptor(
                { path: NOTE_REL_PATH, old_str: 'a', new_str: 'b' },
                undefined,
                'tc-002',
            );

            expect(store.emitProcessEvent).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ type: 'note-file-edit' }),
            );
        });

        it('does NOT emit event when path refers to a different file', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['edit_file'];

            interceptor(
                { path: '/other/file.md', old_str: 'x', new_str: 'y' },
                undefined,
                'tc-003',
            );

            expect(store.emitProcessEvent).not.toHaveBeenCalled();
        });

        it('does NOT emit event when filePath param is missing', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['edit_file'];

            interceptor(
                { old_str: 'x', new_str: 'y' },
                undefined,
                'tc-004',
            );

            expect(store.emitProcessEvent).not.toHaveBeenCalled();
        });

        it('emits note-file-edit via "edit" tool (Claude tool name)', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['edit'];
            expect(interceptor).toBeDefined();

            interceptor(
                { path: ABSOLUTE_NOTE_PATH, old_str: 'old text', new_str: 'new text' },
                undefined,
                'tc-005',
            );

            expect(store.emitProcessEvent).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    type: 'note-file-edit',
                    noteFileEdit: expect.objectContaining({
                        toolCallId: 'tc-005',
                        oldStr: 'old text',
                        newStr: 'new text',
                    }),
                }),
            );
        });

        it('emits note-file-edit via "apply_patch" when patch contains note path', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['apply_patch'];
            expect(interceptor).toBeDefined();

            const patch = `*** Begin Patch\n*** Update File: ${ABSOLUTE_NOTE_PATH}\n@@\n- old line\n+ new line\n*** End Patch`;

            interceptor(
                { patch },
                undefined,
                'tc-006',
            );

            expect(store.emitProcessEvent).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    type: 'note-file-edit',
                    noteFileEdit: expect.objectContaining({
                        toolCallId: 'tc-006',
                        oldStr: '',
                        newStr: '',
                    }),
                }),
            );
        });

        it('emits note-file-edit via "apply_patch" when file path is in the result', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['apply_patch'];

            interceptor(
                { patch: 'some patch without Update File header' },
                `Modified 1 file(s): ${ABSOLUTE_NOTE_PATH}`,
                'tc-007',
            );

            expect(store.emitProcessEvent).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ type: 'note-file-edit' }),
            );
        });

        it('does NOT emit event via "apply_patch" when patch targets a different file', async () => {
            const task = makeNoteChatTask();
            const opts = await (executor as any).buildModeOptions(task, 'do it', undefined);
            const interceptor = opts.toolResultInterceptors?.['apply_patch'];

            const patch = `*** Begin Patch\n*** Update File: /other/file.md\n@@\n- old\n+ new\n*** End Patch`;

            interceptor(
                { patch },
                undefined,
                'tc-008',
            );

            expect(store.emitProcessEvent).not.toHaveBeenCalled();
        });
    });
});
