/**
 * Note Chat Executor
 *
 * Concrete executor for note-chat tasks. Extends ChatBaseExecutor to inject
 * note content as context, giving the AI awareness of the note being discussed.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions, ChatModeExecutionResult } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import {
    appendAutoFolderBlock,
    appendBoundedMemoryContext,
    buildBoundedMemoryAddon,
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
} from './prompt-builder';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Note-context transparency types
// ============================================================================

/** Maximum number of characters injected from the note into the system prompt. */
export const NOTE_CONTENT_CHAR_LIMIT = 8000;

/**
 * Machine-readable status of the note content injected into a chat session.
 * Stored in `process.metadata.noteContentStatus` so the SPA can render a
 * transparent "Attached note" banner.
 */
export interface NoteContentStatus {
    /** High-level content status */
    status: 'attached' | 'truncated' | 'not-found' | 'empty';
    /** The configured character limit for note injection */
    charLimit: number;
    /** Original content length in characters (set when content was read successfully) */
    originalLength?: number;
}

/**
 * Derive the NoteContentStatus from the raw note content (or absence thereof).
 */
export function resolveNoteContentStatus(noteContent: string | undefined): NoteContentStatus {
    if (noteContent === undefined) {
        return { status: 'not-found', charLimit: NOTE_CONTENT_CHAR_LIMIT };
    }
    if (noteContent.length === 0) {
        return { status: 'empty', charLimit: NOTE_CONTENT_CHAR_LIMIT, originalLength: 0 };
    }
    if (noteContent.length > NOTE_CONTENT_CHAR_LIMIT) {
        return { status: 'truncated', charLimit: NOTE_CONTENT_CHAR_LIMIT, originalLength: noteContent.length };
    }
    return { status: 'attached', charLimit: NOTE_CONTENT_CHAR_LIMIT, originalLength: noteContent.length };
}

// ============================================================================
// Executor
// ============================================================================

export class NoteChatExecutor extends ChatBaseExecutor {
    constructor(
        store: ProcessStore,
        options: ChatModeExecutorOptions,
        dataDir?: string,
    ) {
        super(store, options, dataDir);
    }

    /**
     * Override execute to capture pre/post note snapshots for inline diff.
     */
    async execute(task: QueuedTask, prompt: string): Promise<ChatModeExecutionResult> {
        const payload = task.payload as unknown as ChatPayload;
        const noteChat = payload.context?.noteChat;
        const notePath = noteChat?.notePath ?? '';
        const wsId = payload.workspaceId;

        // Capture pre-edit content
        const preEditContent = notePath
            ? await this.readNoteContentForWs(wsId, notePath)
            : undefined;

        const result = await super.execute(task, prompt);

        // Capture post-edit content and store snapshot if changed
        if (notePath && wsId && preEditContent !== undefined) {
            const postEditContent = await this.readNoteContentForWs(wsId, notePath);
            if (postEditContent !== undefined && postEditContent !== preEditContent) {
                const processId = toQueueProcessId(task.id);
                // The assistant turn hasn't been appended yet (lifecycle runner does that after execute()),
                // so predict the next turnIndex as current turns length.
                const process = await this.store.getProcess(processId).catch(() => undefined);
                const turns = process?.conversationTurns ?? [];
                const turnIndex = turns.length;

                const tooLarge = preEditContent.length > SNAPSHOT_SIZE_LIMIT
                    || postEditContent.length > SNAPSHOT_SIZE_LIMIT;

                await appendNoteEditSnapshot(this.store, processId, {
                    editId: `${processId}-${turnIndex}`,
                    notePath,
                    preEditContent: tooLarge ? '' : preEditContent,
                    postEditContent: tooLarge ? '' : postEditContent,
                    timestamp: new Date().toISOString(),
                    turnIndex,
                    ...(tooLarge ? { tooLarge: true } : {}),
                });
            }
        }

        return result;
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const noteChat = payload.context?.noteChat;
        const notePath = noteChat?.notePath ?? '';
        const noteTitle = noteChat?.noteTitle ?? notePath;
        const wsId = payload.workspaceId;

        // Build system message (same pattern as ChatExecutor)
        let autoFolderContext = undefined;
        if (workingDirectory) {
            autoFolderContext = await this.buildAutoFolderContext(
                workingDirectory,
                wsId,
            );
        }

        const boundedMemory = await buildBoundedMemoryAddon(this.dataDir, wsId);
        let systemMessage = appendAutoFolderBlock(
            appendBoundedMemoryContext(
                undefined,
                boundedMemory,
            ),
            autoFolderContext,
        );

        // Inject note content into the system message
        const noteContent = await this.readNoteContentForWs(wsId, notePath);
        const noteContentStatus = resolveNoteContentStatus(noteContent);

        if (noteContent !== undefined && systemMessage) {
            systemMessage = {
                ...systemMessage,
                content: (systemMessage.content ?? '') + buildNoteContextBlock(notePath, noteTitle, noteContent),
            };
        }

        // Persist note content status into process metadata
        void this.patchNoteContentStatus(task.id, noteContentStatus);

        // Standard chat tools
        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const searchConversations = buildSearchConversationsAddon(this.store, wsId, toQueueProcessId(task.id));

        const tools = [...followUp.tools, ...searchConversations.tools, ...boundedMemory.tools];
        const toolSuffix = followUp.suffix + searchConversations.suffix + boundedMemory.suffix;

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + toolSuffix,
        };
    }

    /** Read the note's markdown content from the data directory. */
    private async readNoteContentForWs(wsId: string | undefined, notePath: string): Promise<string | undefined> {
        if (!wsId || !notePath) return undefined;
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        return readNoteContent(effectiveDataDir, wsId, notePath);
    }

    /** Best-effort patch of process metadata with note content status. */
    private async patchNoteContentStatus(taskId: string, status: NoteContentStatus): Promise<void> {
        try {
            const processId = toQueueProcessId(taskId);
            const existing = await this.store.getProcess(processId);
            if (!existing) return;
            await this.store.updateProcess(processId, {
                metadata: { ...(existing.metadata ?? {}), noteContentStatus: status } as any,
            });
        } catch {
            // best-effort — don't fail the task if metadata patch fails
        }
    }
}

// ============================================================================
// Note edit snapshot types (exported for reuse by REST handler and SPA)
// ============================================================================

export interface NoteEditSnapshot {
    /** Unique ID for this edit (e.g. `${processId}-${turnIndex}`). */
    editId: string;
    /** Note path relative to the workspace notes root. */
    notePath: string;
    /** Full markdown content before the AI edit. */
    preEditContent: string;
    /** Full markdown content after the AI edit. Undefined until executor completes. */
    postEditContent?: string;
    /** ISO timestamp of the edit. */
    timestamp: string;
    /** The conversation turn index that produced this edit. */
    turnIndex: number;
    /** When true, content was too large to store — undo is disabled. */
    tooLarge?: boolean;
}

/** Maximum snapshot content size (200 KB). Beyond this, store a flag instead. */
export const SNAPSHOT_SIZE_LIMIT = 200_000;

/**
 * Append a note edit snapshot to process metadata. Best-effort — never throws.
 */
export async function appendNoteEditSnapshot(
    store: ProcessStore,
    processId: string,
    snapshot: NoteEditSnapshot,
): Promise<void> {
    try {
        const existing = await store.getProcess(processId);
        if (!existing) return;
        const noteEdits: NoteEditSnapshot[] =
            (existing.metadata?.noteEdits as NoteEditSnapshot[] | undefined) ?? [];
        noteEdits.push(snapshot);
        await store.updateProcess(processId, {
            metadata: { ...(existing.metadata ?? {}), noteEdits } as any,
        });
    } catch {
        // best-effort — don't fail the task if metadata patch fails
    }
}

// ============================================================================
// Shared helpers (exported for reuse by FollowUpExecutor)
// ============================================================================

export function buildNoteContextBlock(notePath: string, noteTitle: string, content: string): string {
    const truncated = content.length > NOTE_CONTENT_CHAR_LIMIT
        ? content.slice(0, NOTE_CONTENT_CHAR_LIMIT) + '\n\n... (content truncated)'
        : content;
    return (
        '\n\n<note_context>\n' +
        `Title: ${noteTitle}\n` +
        `Path: ${notePath}\n\n` +
        truncated +
        '\n</note_context>'
    );
}

/**
 * Read the note's markdown content from the data directory.
 * Returns undefined if the note cannot be read or the path escapes the notes root.
 */
export async function readNoteContent(dataDir: string, wsId: string, notePath: string): Promise<string | undefined> {
    if (!wsId || !notePath) return undefined;
    const notesRoot = getRepoDataPath(dataDir, wsId, 'notes');
    const resolved = path.resolve(notesRoot, notePath);

    // Security: ensure path stays within notes dir
    const normalizedResolved = path.normalize(resolved);
    const normalizedRoot = path.normalize(notesRoot);
    if (!normalizedResolved.startsWith(normalizedRoot)) return undefined;

    try {
        return await fs.promises.readFile(resolved, 'utf-8');
    } catch {
        return undefined;
    }
}
