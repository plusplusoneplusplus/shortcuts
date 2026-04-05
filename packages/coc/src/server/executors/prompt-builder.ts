/**
 * Prompt Builder
 *
 * Pure-function helpers for assembling prompts and system messages used by
 * CLITaskExecutor.  No class state, no side-effects, no streaming references.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    AutoFolderContext,
    ConversationTurn,
    ProcessStore,
    QueuedTask,
    SystemMessageConfig,
    Tool,
} from '@plusplusoneplusplus/forge';
import {
    READ_ONLY_SYSTEM_MESSAGE,
    buildAutoFolderLocationBlock,
    buildFollowPromptText,
    loadInstructions,
    toForwardSlashes,
    toNativePath,
} from '@plusplusoneplusplus/forge';
import * as fs from 'fs';
import * as path from 'path';
import { createSearchConversationsTool } from '../llm-tools/search-conversations-tool';
import { createSuggestFollowUpsTool } from '../llm-tools/suggest-follow-ups-tool';
import type { ChatMode, ChatPayload, RunScriptPayload } from '../task-types';
import {
    hasCommitChatContext,
    hasResolveCommentsContext,
    hasTaskGenerationContext,
    isChatPayload,
    isRunScriptPayload,
    isRunWorkflowPayload,
} from '../task-types';
import { createSuggestFollowUpsTool } from '../suggest-follow-ups-tool';
import { createUpdateTaskStatusTool } from '../update-task-status-tool';
import { createWorkItemTool, type BroadcastWorkItemFn } from '../create-work-item-tool';

// ============================================================================
// System Message Builders
// ============================================================================

/**
 * Builds the system message config for the given chat mode.
 * Both `ask` and `plan` modes inject the read-only system message.
 * `autopilot` (and any unknown mode) returns `undefined`.
 *
 * NOTE: The auto-folder location block is NOT included here.
 * Use {@link appendAutoFolderBlock} after {@link withRepoInstructions}
 * to ensure the canonical save-location directive is always last.
 */
export function buildModeSystemMessage(
    mode: ChatMode | undefined,
): SystemMessageConfig | undefined {
    if (mode !== 'ask' && mode !== 'plan') {
        return undefined;
    }
    return { mode: 'append' as const, content: READ_ONLY_SYSTEM_MESSAGE };
}

/**
 * Appends the auto-folder location block to an existing system message config.
 * Must be called AFTER {@link withRepoInstructions} so the canonical
 * save-location directive appears last and cannot be overridden by repo instructions.
 */
export function appendAutoFolderBlock(
    systemMessage: SystemMessageConfig | undefined,
    autoFolderContext: AutoFolderContext | undefined,
): SystemMessageConfig | undefined {
    if (!autoFolderContext || !systemMessage) return systemMessage;
    const block = buildAutoFolderLocationBlock(
        toForwardSlashes(autoFolderContext.tasksRoot),
        autoFolderContext.existingFolders,
    );
    return { mode: 'append' as const, content: systemMessage.content + '\n\n' + block };
}

// ============================================================================
// Memory Context Injection
// ============================================================================

/** Maximum characters of consolidated memory injected into the system prompt. */
const MEMORY_CONTEXT_MAX_CHARS = 8192;

/**
 * Appends project memory from consolidated.md to the system message.
 * Checks PerRepoPreferences.memoryExtraction.enabled — returns unchanged
 * system message if disabled or if no consolidated memory exists.
 *
 * Must be called AFTER {@link withRepoInstructions} and BEFORE
 * {@link appendAutoFolderBlock} so memory context sits between repo
 * instructions and the auto-folder directive.
 */
export function appendMemoryContext(
    systemMessage: SystemMessageConfig | undefined,
    dataDir: string | undefined,
    workspaceId: string | undefined,
): SystemMessageConfig | undefined {
    if (!dataDir || !workspaceId) return systemMessage;

    try {
        const prefs = readRepoPreferences(dataDir, workspaceId);
        if (!prefs.memoryExtraction?.enabled) return systemMessage;
    } catch {
        return systemMessage;
    }

    let content: string;
    try {
        const consolidatedPath = path.join(
            getRepoDataPath(dataDir, workspaceId, path.join('memory', 'observations')),
            'consolidated.md',
        );
        if (!fs.existsSync(consolidatedPath)) return systemMessage;
        content = fs.readFileSync(consolidatedPath, 'utf-8').trim();
        if (content.length === 0) return systemMessage;
    } catch {
        return systemMessage;
    }

    // Truncate if too large
    if (content.length > MEMORY_CONTEXT_MAX_CHARS) {
        content = content.slice(0, MEMORY_CONTEXT_MAX_CHARS) + '\n\n(truncated — full memory in consolidated.md)';
    }

    const memoryBlock = [
        '## Project Memory',
        '',
        'These are facts learned from previous conversations about this codebase.',
        'They may be outdated — verify against current code when in doubt.',
        '',
        content,
    ].join('\n');

    const base = systemMessage?.content ?? '';
    const appended = base.length > 0 ? base + '\n\n' + memoryBlock : memoryBlock;
    return { mode: 'append' as const, content: appended };
}

/**
 * Appends per-repo custom instructions (from `.github/coc/`) to an existing
 * system message config.  If no instructions exist for the repo/mode, the
 * original config is returned unchanged.
 */
export async function withRepoInstructions(
    systemMessage: SystemMessageConfig | undefined,
    workingDirectory: string | undefined,
    mode: ChatMode | undefined,
): Promise<SystemMessageConfig | undefined> {
    if (!workingDirectory || !mode) return systemMessage;
    let instructions: string | undefined;
    try {
        instructions = await loadInstructions(workingDirectory, mode);
    } catch {
        return systemMessage;
    }
    if (!instructions) return systemMessage;
    const appended = systemMessage
        ? systemMessage.content + '\n\n' + instructions
        : instructions;
    return { mode: 'append' as const, content: appended };
}

// ============================================================================
// Context File Suffix
// ============================================================================

/**
 * Look for a CONTEXT.md file in the same directory as the plan file.
 * Returns a prompt suffix like "See context details in /abs/path/CONTEXT.md",
 * or undefined if no context file exists.
 */
export function findContextFileSuffix(planFilePath?: string): string | undefined {
    if (!planFilePath) return undefined;
    try {
        const dir = path.dirname(planFilePath);
        const contextPath = path.join(dir, 'CONTEXT.md');
        if (fs.existsSync(contextPath)) {
            // Use native path for cross-platform consistency in context references
            const normalizedPath = toNativePath(contextPath);
            return `See context details in ${normalizedPath}`;
        }
    } catch {
        // Non-fatal
    }
    return undefined;
}

// ============================================================================
// Prompt Extraction
// ============================================================================

/**
 * Extract the user-facing prompt string from a queued task.
 * Pure function — derives the prompt solely from the task payload.
 */
export function extractPrompt(task: QueuedTask): string {
    if (isRunWorkflowPayload(task.payload)) {
        return `Run workflow: ${path.basename(task.payload.workflowPath)}`;
    }

    if (isRunScriptPayload(task.payload)) {
        const payload = task.payload as unknown as RunScriptPayload;
        return `Run script: \`${payload.script}\``;
    }

    if (isChatPayload(task.payload)) {
        const payload = task.payload as unknown as ChatPayload;
        const prompt = payload.prompt || task.displayName || 'Chat message';

        // Task generation: the prompt is just the user's input; enrichment happens later
        if (hasTaskGenerationContext(task.payload)) {
            return prompt;
        }

        // Resolve comments: the prompt is the template
        if (hasResolveCommentsContext(task.payload)) {
            return prompt;
        }

        // Commit chat: reference the commit by ID; the AI can inspect it via tools
        const ctx = payload.context;
        if (hasCommitChatContext(task.payload)) {
            const { commitHash, commitMessage } = ctx!.commitChat!;
            const parts: string[] = [];
            parts.push(`I'm asking about git commit ${commitHash}.`);
            if (commitMessage) {
                parts.push(`Commit message: ${commitMessage}`);
            }
            parts.push(`\n${prompt}`);
            return parts.join('\n');
        }

        // Context files: resolve file-path-based prompts using shared builder
        if (ctx?.files?.length) {
            const promptFile = ctx.files[0];
            const planFile = ctx.files.length > 1 ? ctx.files[1] : undefined;
            const additionalContext = ctx.blocks?.map(b => b.content).join('\n\n');
            const contextSuffix = findContextFileSuffix(planFile);

            // When promptFile is a real path, use file-path-reference style.
            // When promptFile is empty/falsy, use the user's typed prompt as direct content.
            const base = buildFollowPromptText(
                promptFile
                    ? { promptFilePath: promptFile, planFilePath: planFile, additionalContext }
                    : { promptContent: prompt, planFilePath: planFile, additionalContext },
            );

            return contextSuffix ? `${base}\n\n${contextSuffix}` : base;
        }

        return prompt;
    }

    return task.displayName || `Queue task: ${task.type}`;
}

// ============================================================================
// Skill Content
// ============================================================================

/**
 * Skill content is now applied via `skillDirectories` passed to the AI SDK.
 * This function is kept for backward compatibility but returns the prompt unchanged.
 */
export function applySkillContent(prompt: string, _task: QueuedTask): string {
    return prompt;
}

/**
 * Preserve explicit slash-selected skill intent without eagerly injecting
 * the skill bodies. The native runtime still resolves the skill content on demand.
 */
export function prependSelectedSkillsDirective(prompt: string, selectedSkills?: string[]): string {
    if (!selectedSkills || selectedSkills.length === 0) {
        return prompt;
    }

    const uniqueSkills = [...new Set(selectedSkills.filter(skill => typeof skill === 'string' && skill.trim().length > 0))];
    if (uniqueSkills.length === 0) {
        return prompt;
    }

    const directive = [
        '<selected_skills>',
        `The user explicitly selected these skills: ${uniqueSkills.join(', ')}.`,
        '</selected_skills>',
    ].join('\n');

    return `${directive}\n\n${prompt}`;
}

// ============================================================================
// Conversation History
// ============================================================================

/**
 * Build a conversation history context string from prior turns.
 * Injected as a system message so a fresh session has context from earlier turns.
 */
export function buildConversationHistoryContext(turns?: ConversationTurn[]): string | undefined {
    if (!turns || turns.length === 0) return undefined;

    const lines: string[] = ['<conversation_history>'];
    for (const turn of turns) {
        const role = turn.role === 'user' ? 'User' : 'Assistant';
        // Trim long assistant responses to avoid blowing up the context window
        const content =
            turn.role === 'assistant' && turn.content.length > 2000
                ? turn.content.slice(0, 2000) + '… (truncated)'
                : turn.content;
        lines.push(`[${role}]: ${content}`);
    }
    lines.push('</conversation_history>');
    lines.push("Continue this conversation. The user's next message follows.");
    return lines.join('\n');
}

// ============================================================================
// Follow-Up Suggestions
// ============================================================================

/**
 * Builds the tools array and prompt suffix for follow-up suggestions.
 * Returns empty tools and empty suffix when suggestions are disabled.
 *
 * @param enabled  Whether to attach the suggestion tool.
 * @param count    Number of suggestions to request.
 */
export function buildFollowUpSuggestionsAddon(
    enabled: boolean,
    count: number,
): { tools: Tool<any>[]; suffix: string } {
    if (!enabled) {
        return { tools: [], suffix: '' };
    }
    return {
        tools: [createSuggestFollowUpsTool()],
        suffix: `\n\nWhen suggesting follow-ups, provide exactly ${count} suggestions. Each suggestion must be a short imperative action phrase (not a question), for example: "Show me an example", "Explain the retry config", "Generate the fix".`,
    };
}

// ============================================================================
// Update Task Status
// ============================================================================

/**
 * Builds the tools array and prompt suffix for the `update_task_status` tool.
 * The tool is only injected when the execution context includes a plan file.
 *
 * @param hasPlanFile  Whether the task context includes a plan file.
 */
export function buildUpdateTaskStatusAddon(
    hasPlanFile: boolean,
): { tools: Tool<any>[]; suffix: string } {
    if (!hasPlanFile) {
        return { tools: [], suffix: '' };
    }

    const { tool } = createUpdateTaskStatusTool();
    const suffix =
        '\n\nYou have access to the `update_task_status` tool. ' +
        'Provide the absolute file path and new status. ' +
        'Call it when you begin work (set in-progress) and when complete (set done).';

    return { tools: [tool], suffix };
}

// ============================================================================
// Create Work Item
// ============================================================================

/**
 * Builds the tools array and prompt suffix for the `create_work_item` tool.
 * The tool is only injected when a valid dataDir and repoId are available.
 *
 * @param dataDir     - Base data directory (e.g. `~/.coc`).
 * @param repoId      - Workspace / repo ID the item should be created in.
 * @param broadcastFn - Optional function to broadcast a WebSocket event after creation.
 */
export function buildCreateWorkItemAddon(
    dataDir: string | undefined,
    repoId: string | undefined,
    broadcastFn?: BroadcastWorkItemFn,
): { tools: Tool<any>[]; suffix: string } {
    if (!dataDir || !repoId) {
        return { tools: [], suffix: '' };
    }

    const { tool } = createWorkItemTool(dataDir, repoId, broadcastFn);
    const suffix =
        '\n\nYou have access to the `create_work_item` tool. ' +
        'Call it when the user explicitly asks to create a work item, track a task, or save something for later execution.';

    return { tools: [tool], suffix };
}
