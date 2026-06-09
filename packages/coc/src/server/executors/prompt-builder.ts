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
    SendMessageOptions,
    SystemMessageConfig,
} from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
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
import { createGetConversationTool } from '../llm-tools/get-conversation-tool';
import { createSuggestFollowUpsTool } from '../llm-tools/suggest-follow-ups-tool';
import { createAskUserTool } from '../llm-tools/ask-user-tool';
import type { AskUserAnswerInput, AskUserAnswerValue, AskUserToolDeps } from '../llm-tools/ask-user-tool';
import { createCreateUpdateWorkItemTool, type BroadcastWorkItemFn } from '../llm-tools/create-update-work-item-tool';
import type { ChatMode, ChatPayload, PrClassificationPayload, RunScriptPayload } from '../tasks/task-types';
import {
    hasCommitChatContext,
    hasPullRequestChatContext,
    hasResolveCommentsContext,
    hasTaskGenerationContext,
    isChatPayload,
    isPrClassificationPayload,
    isRunScriptPayload,
    isRunWorkflowPayload,
    normalizeChatMode,
    resolveInstructionMode,
} from '../tasks/task-types';
import type { ForEachGenerationContext, MapReduceGenerationContext } from '../tasks/task-types';
import { createTavilyWebSearchTool } from '../llm-tools/tavily-web-search-tool';
import { createExcalidrawTools } from '../llm-tools/excalidraw-tools';
import { filterDisabledLlmTools } from '../llm-tools/llm-tool-registry';
import { createScheduleWakeupTool, createCreateLoopTool, createCancelLoopTool, createListLoopsTool } from '../llm-tools/loop-tools';
import type { LoopToolDeps } from '../llm-tools/loop-tools';


// ============================================================================
// System Message Builder (fluent API — preferred over the helpers below)
// ============================================================================

export { systemMessageBuilder } from './system-message-builder';

// ============================================================================
// System Message Builders
// ============================================================================

/**
 * Builds the system message config for the given chat mode.
 * Ask mode injects the read-only system message.
 * `autopilot` (and any unknown mode) returns `undefined`.
 *
 * NOTE: The auto-folder location block is NOT included here.
 * Use {@link appendAutoFolderBlock} after {@link withRepoInstructions}
 * to ensure the canonical save-location directive is always last.
 */
export function buildModeSystemMessage(
    mode: ChatMode | undefined,
): SystemMessageConfig | undefined {
    if (normalizeChatMode(mode) !== 'ask') {
        return undefined;
    }
    return { mode: 'append' as const, content: READ_ONLY_SYSTEM_MESSAGE };
}

export function buildForEachGenerationSystemMessage(
    context: ForEachGenerationContext | null | undefined,
): SystemMessageConfig | undefined {
    if (!context) return undefined;
    const content = `\
You are running a visible CoC For Each item-plan generation chat.

The user is iteratively designing a For Each parent run. Generate or refine a proposed item plan only; do not start child chats, enqueue tasks, approve runs, or execute the items.

Generation metadata:
- Workspace ID: ${context.workspaceId}
- Generation ID: ${context.generationId}
- Child chat mode for proposed items: ${context.childMode}
- Current approval status: ${context.status}

Response requirements:
- Start with a concise human-readable summary of the proposed plan.
- Include item count, child mode, shared instructions if any are implied, item titles, prompts, and dependencies.
- Include an "Advanced JSON" section containing a single fenced json object with an "items" array.
- Every item must have a stable filesystem-safe id, required title and prompt, valid dependsOn item ids, and status "pending".
- If a follow-up asks for a refinement, return the complete latest proposed plan, not a patch.
- If the request cannot be converted into a valid item plan, say so explicitly and do not invent child execution results.`;
    return { mode: 'append' as const, content };
}

export function buildMapReduceGenerationSystemMessage(
    context: MapReduceGenerationContext | null | undefined,
): SystemMessageConfig | undefined {
    if (!context) return undefined;
    const content = `\
You are running a visible CoC Map Reduce plan-generation chat.

The user is iteratively designing a Map Reduce parent run. Generate or refine a proposed map plan and reduce instructions only; do not start child chats, enqueue tasks, approve runs, or execute the map or reduce steps.

Generation metadata:
- Workspace ID: ${context.workspaceId}
- Generation ID: ${context.generationId}
- Child chat mode for proposed map/reduce child chats: ${context.childMode}
- Current approval status: ${context.status}

Response requirements:
- Start with a concise human-readable summary of the proposed map/reduce plan.
- Include item count, child mode, max parallelism, shared instructions if any are implied, reduce instructions, map item titles, prompts, and dependencies.
- Include an "Advanced JSON" section containing a single fenced json object with "maxParallel", "reduceInstructions", and an "items" array.
- Every map item must have a stable filesystem-safe id, required title and prompt, valid dependsOn item ids, and status "pending".
- maxParallel must be a positive integer; use 3 unless the user explicitly requests another concurrency cap.
- reduceInstructions must explain how the reduce child chat should aggregate every completed map item output into one final result.
- If a follow-up asks for a refinement, return the complete latest proposed plan, not a patch.
- If the request cannot be converted into a valid Map Reduce plan, say so explicitly and do not invent child execution results.`;
    return { mode: 'append' as const, content };
}

/**
 * Appends the auto-folder location block to an existing system message config.
 * Must be called AFTER {@link withRepoInstructions} so the canonical
 * save-location directive appears last and cannot be overridden by repo instructions.
 *
 * @deprecated Use {@link systemMessageBuilder} instead.
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
// Memory V2 Context Injection
// ============================================================================

// Re-export the Memory V2 addon for executor convenience.
export { buildMemoryV2Addon } from './memory-v2-addon';
export type { MemoryV2Addon } from './memory-v2-addon';

/**
 * Appends per-repo custom instructions (from `.github/coc/`) to an existing
 * system message config.  If no instructions exist for the repo/mode, the
 * original config is returned unchanged.
 *
 * @deprecated Use {@link systemMessageBuilder} instead.
 */
export async function withRepoInstructions(
    systemMessage: SystemMessageConfig | undefined,
    workingDirectory: string | undefined,
    mode: ChatMode | undefined,
): Promise<SystemMessageConfig | undefined> {
    if (!workingDirectory || !mode) return systemMessage;
    let instructions: string | undefined;
    try {
        instructions = await loadInstructions(workingDirectory, resolveInstructionMode(mode));
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

    if (isPrClassificationPayload(task.payload)) {
        return (task.payload as unknown as PrClassificationPayload).prompt;
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

        // Pull request chat: reference the PR by number/id; AI can inspect via tools
        if (hasPullRequestChatContext(task.payload)) {
            const { prId, prNumber, prTitle } = ctx!.pullRequestChat!;
            const parts: string[] = [];
            const label = prNumber != null ? `#${prNumber}` : prId;
            parts.push(`I'm asking about pull request ${label}.`);
            if (prTitle) {
                parts.push(`PR title: ${prTitle}`);
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

export interface SelectedSkillReference {
    name: string;
    skillFilePath: string;
}

/**
 * Resolve selected skill names to concrete SKILL.md file paths without reading
 * the skill bodies into the prompt. The first matching skill directory wins,
 * matching the search order passed to the SDK.
 */
export function resolveSelectedSkillReferences(
    selectedSkills?: string[],
    skillDirectories?: string[],
    disabledSkills?: string[],
): SelectedSkillReference[] {
    if (!selectedSkills || selectedSkills.length === 0 || !skillDirectories || skillDirectories.length === 0) {
        return [];
    }

    const disabled = new Set((disabledSkills ?? []).filter(skill => typeof skill === 'string'));
    const uniqueSkills = [...new Set(selectedSkills.filter(skill => typeof skill === 'string' && skill.trim().length > 0))];
    const references: SelectedSkillReference[] = [];

    for (const name of uniqueSkills) {
        if (disabled.has(name)) {
            continue;
        }
        for (const dir of skillDirectories) {
            const skillFilePath = path.join(dir, name, 'SKILL.md');
            if (fs.existsSync(skillFilePath)) {
                references.push({ name, skillFilePath });
                break;
            }
        }
    }

    return references;
}

/**
 * Preserve explicit slash-selected skill intent without eagerly injecting
 * the skill bodies. When paths are available, point the agent at SKILL.md files
 * so providers without a native skill registry can still load the instructions.
 */
export function prependSelectedSkillsDirective(
    prompt: string,
    selectedSkills?: string[],
    selectedSkillReferences?: SelectedSkillReference[],
): string {
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
        ...(selectedSkillReferences && selectedSkillReferences.length > 0
            ? [
                'Load the selected skill instructions from these SKILL.md files before proceeding:',
                ...selectedSkillReferences.map(ref => `- ${ref.name}: ${ref.skillFilePath}`),
            ]
            : []),
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
// Search Conversations
// ============================================================================

/**
 * Builds the tools array and prompt suffix for the conversation-history tools:
 * `search_conversations` (FTS5 keyword search) and `get_conversation` (fetch a
 * full transcript by processId, compacted to fit a token budget).
 *
 * Tools are only injected when the store supports `searchConversations` (SQLite only).
 *
 * @param store        The ProcessStore instance.
 * @param workspaceId  Optional default workspace to scope searches.
 * @param currentProcessId Optional process ID to exclude from results (current session).
 */
export function buildSearchConversationsAddon(
    store: ProcessStore,
    workspaceId?: string,
    currentProcessId?: string,
): { tools: Tool<any>[]; suffix: string } {
    if (!store.searchConversations) {
        return { tools: [], suffix: '' };
    }

    const { tool: searchTool } = createSearchConversationsTool({
        store,
        workspaceId,
        currentProcessId,
    });
    const { tool: getTool } = createGetConversationTool({ store, workspaceId });
    const suffix =
        '\n\nconversation-history tools: `search_conversations` (keyword search, or no query + since/until to list recent sessions) ' +
        'and `get_conversation` (full transcript by processId). Use when the user references past discussions.';

    return { tools: [searchTool, getTool], suffix };
}

// ============================================================================
// Ask User
// ============================================================================

/**
 * Builds the tools array, prompt suffix, and resolution handles for the
 * `ask_user` interactive tool. Returns empty tools/suffix when disabled.
 *
 * The returned `answerQuestion`, `skipQuestion`, and `cancelAll` are stored
 * on the session state so the API endpoint and session cleanup can reach them.
 *
 * @param enabled  Whether to attach the ask_user tool.
 * @param deps     Callbacks for emitting the SSE event and computing the current turn index.
 */
export function buildAskUserAddon(
    enabled: boolean,
    deps: AskUserToolDeps,
): {
    tools: Tool<any>[];
    suffix: string;
    answerQuestion: (questionId: string, answer: AskUserAnswerValue) => boolean;
    skipQuestion: (questionId: string) => boolean;
    answerQuestions: (responses: AskUserAnswerInput[]) => boolean;
    cancelAll: () => void;
    hasPending: () => boolean;
} {
    if (!enabled) {
        return {
            tools: [],
            suffix: '',
            answerQuestion: () => false,
            skipQuestion: () => false,
            answerQuestions: () => false,
            cancelAll: () => {},
            hasPending: () => false,
        };
    }

    const { tool, answerQuestion, skipQuestion, answerQuestions, cancelAll, hasPending } = createAskUserTool(deps);
    const suffix =
        '\n\nYou have access to the `ask_user` tool. It takes `{ questions: [...] }`; put related clarification, ' +
        'confirmation, or choice questions in one call instead of calling the tool repeatedly. The user will see one interactive widget. ' +
        'Every question has Skip and Need more context options, so the user is never stuck. If the tool result includes `deferred: true` with `reason: "needs-context"`, provide the missing context and ask a revised version of that question again when the answer is still needed; if it is no longer needed, explain why. Do not treat it as permission to ignore the question. ' +
        'Do NOT use ask_user for simple yes/no that can be inferred from context.';

    return { tools: [tool], suffix, answerQuestion, skipQuestion, answerQuestions, cancelAll, hasPending };
}

// ============================================================================
// Create/Update Work Item
// ============================================================================

/**
 * Builds the tools array and prompt suffix for the `create_update_work_item` tool.
 * The tools are only injected when a valid dataDir and repoId are available.
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

    const { tool: workItemTool } = createCreateUpdateWorkItemTool(dataDir, repoId, broadcastFn);

    return { tools: [workItemTool], suffix: '' };
}

/**
 * Validates that a session does not enable both the custom CoC `ask_user` tool
 * and the SDK's native `onUserInputRequest` callback simultaneously.
 *
 * CoC uses its own custom `ask_user` tool (with structured question types,
 * SSE-driven SPA widget, and pending-question lifecycle). The SDK also has a
 * simpler built-in `ask_user` capability gated by `onUserInputRequest`.
 * Enabling both creates ambiguous ownership of user prompts.
 *
 * Call this before sending options to the SDK to catch configuration mistakes.
 *
 * @throws Error if both paths are active.
 */
export function assertNoAskUserConflict(options: Pick<SendMessageOptions, 'tools' | 'onUserInputRequest'>): void {
    if (!options.onUserInputRequest) return;
    const hasCustomAskUser = options.tools?.some(t => t.name === 'ask_user') ?? false;
    if (hasCustomAskUser) {
        throw new Error(
            'Configuration conflict: both a custom ask_user tool and native ' +
            'onUserInputRequest are enabled. Only one ask-user authority should ' +
            'be active per session.',
        );
    }
}

// ============================================================================
// Tavily Web Search
// ============================================================================

/**
 * Builds the tools array and prompt suffix for the `tavily_web_search` tool.
 * The tool is always created; filtering by disabled state is done later via
 * {@link applyLlmToolPreferences}.
 *
 * @param dataDir - Base data directory for resolving providers.json / API key.
 */
export function buildTavilyWebSearchAddon(
    dataDir: string | undefined,
): { tools: Tool<any>[]; suffix: string } {
    if (!dataDir) {
        return { tools: [], suffix: '' };
    }

    const { tool } = createTavilyWebSearchTool({ dataDir });
    const suffix =
        '\n\nYou have access to the `tavily_web_search` tool. ' +
        'Use it proactively when the user asks about recent events, version-specific behavior, ' +
        'newly released libraries/APIs, ongoing incidents, or anything likely past your knowledge cutoff.';

    return { tools: [tool], suffix };
}

// ============================================================================
// Schedule Wakeup Tool
// ============================================================================

export function buildScheduleWakeupAddon(
    deps: import('../llm-tools/loop-tools').WakeupToolDeps | undefined,
): { tools: Tool<any>[]; suffix: string } {
    if (!deps) {
        return { tools: [], suffix: '' };
    }

    const { tool } = createScheduleWakeupTool(deps);
    const suffix =
        '\n\nYou have access to the `scheduleWakeup` tool. ' +
        'Use it to schedule a one-shot delayed follow-up message into the current conversation. ' +
        'Specify a delay like "30s", "5m", or "1h". Minimum delay is 1 second.';

    return { tools: [tool], suffix };
}

// ============================================================================
// Loop Tools (skill-gated — injected only when /loop skill is active)
// ============================================================================

export function buildLoopToolsAddon(
    deps: LoopToolDeps | undefined,
): { tools: Tool<any>[]; suffix: string } {
    if (!deps) {
        return { tools: [], suffix: '' };
    }

    const { tool: createTool } = createCreateLoopTool(deps);
    const { tool: cancelTool } = createCancelLoopTool(deps);
    const { tool: listTool } = createListLoopsTool(deps);

    const suffix =
        '\n\nLoop management tools (`createLoop`, `cancelLoop`, `listLoops`) are active via the /loop skill. ' +
        'When a message starts with an interval + task (e.g. "1m check status"), treat it as a fixed-interval ' +
        'loop: perform the task now, then call `createLoop`. Do not use `scheduleWakeup` for this pattern.';

    return { tools: [createTool, cancelTool, listTool], suffix };
}

// ============================================================================
// Excalidraw Tools
// ============================================================================

export function buildExcalidrawToolsAddon(
    dataDir: string | undefined,
    workspaceId: string | undefined,
): { tools: Tool<any>[]; suffix: string } {
    if (!dataDir || !workspaceId) {
        return { tools: [], suffix: '' };
    }

    const { createOrUpdate, read } = createExcalidrawTools({ dataDir, workspaceId });

    return { tools: [createOrUpdate, read], suffix: '' };
}

// ============================================================================
// LLM Tool Preferences
// ============================================================================

/**
 * Filters the assembled tools + per-addon prose by the per-repo disabled
 * LLM tools list, and returns the surviving tools alongside the
 * aggregated `toolGuidance` block.
 *
 * Each entry in `toolsWithSuffix` is a named tool paired with the prose
 * that describes it. When a tool is disabled, both the tool and its prose
 * are removed from the output.
 *
 * The aggregated prose is exposed as `toolGuidance` (not `suffix`) because
 * callers route it into the system message via
 * `systemMessageBuilder().appendToolGuidance(...)` rather than appending
 * it to the user prompt.
 */
export function applyLlmToolPreferences(
    toolsWithSuffix: Array<{ tools: Tool<any>[]; suffix: string }>,
    disabledLlmTools: string[] | undefined,
): { tools: Tool<any>[]; toolGuidance: string } {
    const allTools: Tool<any>[] = [];
    let toolGuidance = '';

    for (const entry of toolsWithSuffix) {
        const filtered = filterDisabledLlmTools(entry.tools, disabledLlmTools);
        if (filtered.length > 0) {
            allTools.push(...filtered);
            toolGuidance += entry.suffix;
        }
    }

    return { tools: allTools, toolGuidance };
}

// Re-export for convenience
export { filterDisabledLlmTools } from '../llm-tools/llm-tool-registry';
