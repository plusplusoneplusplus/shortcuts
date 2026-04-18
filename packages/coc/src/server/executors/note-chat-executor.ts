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
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
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
// NoteChatExecutor
// ============================================================================

const FILE_EDIT_TOOLS = ['edit_file', 'str_replace_editor', 'str_replace_based_edit_tool'];

export class NoteChatExecutor extends ChatBaseExecutor {
    constructor(
        store: ProcessStore,
        options: ChatModeExecutorOptions,
        dataDir?: string,
    ) {
        super(store, options, dataDir);
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
        const noteContent = await this.readNoteContent(wsId, notePath);
        if (noteContent !== undefined && systemMessage) {
            systemMessage = {
                ...systemMessage,
                content: (systemMessage.content ?? '') + buildNoteContextBlock(notePath, noteTitle, noteContent),
            };
        }

        // Standard chat tools
        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const searchConversations = buildSearchConversationsAddon(this.store, wsId);

        const tools = [...followUp.tools, ...searchConversations.tools, ...boundedMemory.tools];
        const toolSuffix = followUp.suffix + searchConversations.suffix + boundedMemory.suffix;

        // Resolve the absolute note path for comparison against tool-reported paths
        const processId = toQueueProcessId(task.id);
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        const notesRoot = wsId ? getRepoDataPath(effectiveDataDir, wsId, 'notes') : undefined;
        const absoluteNotePath = notesRoot && notePath
            ? path.resolve(notesRoot, notePath)
            : undefined;

        let toolResultInterceptors: ChatModeAIOptions['toolResultInterceptors'];

        if (absoluteNotePath && wsId) {
            const store = this.store;
            const interceptor = (params: Record<string, unknown>, _result: string | undefined, toolCallId: string) => {
                const filePath = String(params.path ?? params.filePath ?? '');
                const oldStr = String(params.old_str ?? params.oldStr ?? '');
                const newStr = String(params.new_str ?? params.newStr ?? '');
                if (!filePath || !isNoteFile(filePath, absoluteNotePath, notesRoot)) return;
                store.emitProcessEvent(processId, {
                    type: 'note-file-edit',
                    noteFileEdit: { toolCallId, filePath, oldStr, newStr },
                });
            };

            toolResultInterceptors = Object.fromEntries(FILE_EDIT_TOOLS.map(n => [n, interceptor]));
        }

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + toolSuffix,
            toolResultInterceptors,
        };
    }

    /** Read the note's markdown content from the data directory. */
    private async readNoteContent(wsId: string | undefined, notePath: string): Promise<string | undefined> {
        if (!wsId || !notePath) return undefined;
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        const notesRoot = getRepoDataPath(effectiveDataDir, wsId, 'notes');
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
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check whether a file path reported by the AI tool corresponds to the currently
 * open note. Normalizes both to forward-slash to handle OS differences.
 */
function isNoteFile(filePath: string, absoluteNotePath: string, notesRoot: string | undefined): boolean {
    const normalizeSlashes = (p: string) => p.replace(/\\/g, '/');

    const normalizedFilePath = normalizeSlashes(path.resolve(filePath));
    const normalizedNotePath = normalizeSlashes(absoluteNotePath);

    if (normalizedFilePath === normalizedNotePath) return true;

    // Also try resolving relative to notes root
    if (notesRoot) {
        const resolvedFromRoot = normalizeSlashes(path.resolve(notesRoot, filePath));
        if (resolvedFromRoot === normalizedNotePath) return true;
    }

    return false;
}

function buildNoteContextBlock(notePath: string, noteTitle: string, content: string): string {
    const truncated = content.length > 8000
        ? content.slice(0, 8000) + '\n\n... (content truncated)'
        : content;
    return (
        '\n\n<note_context>\n' +
        `Title: ${noteTitle}\n` +
        `Path: ${notePath}\n\n` +
        truncated +
        '\n</note_context>'
    );
}
