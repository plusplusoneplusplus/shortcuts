/**
 * Note Chat Executor
 *
 * Concrete executor for note-chat tasks. Extends ChatBaseExecutor.
 * The note path is prepended to the user's first message by the client;
 * the AI reads the note file via its file-reading tools as needed.
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
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions, ChatModeExecutionResult } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import {
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
    applyLlmToolPreferences,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import { readEffectiveDisabledLlmTools, readRepoPreferences } from '../preferences-handler';
import { getRepoDataPath } from '../paths';

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
     * Override execute to capture pre/post note snapshots for inline diff,
     * and to inject the note model preference when the task has no explicit model.
     */
    async execute(task: QueuedTask, prompt: string): Promise<ChatModeExecutionResult> {
        const payload = task.payload as unknown as ChatPayload;
        const noteChat = payload.context?.noteChat;
        const notePath = noteChat?.notePath ?? '';
        const wsId = payload.workspaceId;

        // Inject the note model preference when the task has no explicit model.
        // Resolution: task.config.model > defaultModels.note > lastModels.note > 'claude-sonnet-4.6'.
        if (!task.config.model) {
            const repoPrefs = this.dataDir && wsId
                ? readRepoPreferences(this.dataDir, wsId)
                : undefined;
            const noteModel = repoPrefs?.defaultModels?.note
                ?? repoPrefs?.defaultModel
                ?? repoPrefs?.lastModels?.note
                ?? 'claude-sonnet-4.6';
            task = { ...task, config: { ...task.config, model: noteModel } };
        }

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
        const wsId = payload.workspaceId;

        // Build auto-folder context (same pattern as ChatExecutor)
        let autoFolderContext = undefined;
        if (workingDirectory) {
            autoFolderContext = await this.buildAutoFolderContext(
                workingDirectory,
                wsId,
            );
        }

        // Standard chat tools
        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const searchConversations = buildSearchConversationsAddon(this.store, wsId, toQueueProcessId(task.id));
        const tavilySearch = buildTavilyWebSearchAddon(this.dataDir);

        const disabledLlmTools = this.dataDir && wsId
            ? readEffectiveDisabledLlmTools(this.dataDir, wsId)
            : undefined;

        const { tools, toolGuidance } = applyLlmToolPreferences(
            [followUp, searchConversations, tavilySearch],
            disabledLlmTools,
        );

        const systemMessage = await systemMessageBuilder()
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            .appendToolGuidance(toolGuidance)
            .appendAutoFolder(autoFolderContext)
            .build();

        const payloadMode = payload.mode;
        const agentMode: AgentMode =
            payloadMode === 'ask' ? 'interactive'
            : payloadMode === 'autopilot' ? 'autopilot'
            : 'interactive';

        return {
            agentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt,
            dispose: undefined,
        };
    }

    /** Read the note's markdown content from the data directory. */
    private async readNoteContentForWs(wsId: string | undefined, notePath: string): Promise<string | undefined> {
        if (!wsId || !notePath) return undefined;
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        return readNoteContent(effectiveDataDir, wsId, notePath);
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
