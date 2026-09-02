/**
 * Commit Chat Executor
 *
 * Concrete executor for commit-chat tasks. Extends ChatBaseExecutor to inject
 * the `add_diff_comment` tool, allowing the AI to leave persistent review
 * comments anchored to specific lines of a commit diff.
 *
 * Pre-binds commit context (commitHash, parentHash, workspaceId) at
 * construction time so the AI only provides per-call values (filePath,
 * lineStart, side, comment).
 */

import { execGitAsync } from '@plusplusoneplusplus/forge/git';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import { DiffCommentsManager } from '../tasks/comments/diff-comments-manager';
import { createAddDiffCommentTool } from '../llm-tools/add-diff-comment-tool';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import {
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
    applyLlmToolPreferences,
    buildSourceLocationMarkdownLinkSystemMessage,
} from './prompt-builder';
import { buildChatModeDirective, loadChatModeInstructions, prependChatModeDirective } from './chat-mode-directive';
import { systemMessageBuilder } from './system-message-builder';
import { readEffectiveDisabledLlmTools } from '../preferences-handler';
import type { ProcessWebSocketServer } from '../streaming/websocket';

// ============================================================================
// CommitChatExecutor
// ============================================================================

export class CommitChatExecutor extends ChatBaseExecutor {
    private readonly getWsServer?: () => ProcessWebSocketServer | undefined;

    constructor(
        store: ProcessStore,
        options: ChatModeExecutorOptions,
        getWsServer?: () => ProcessWebSocketServer | undefined,
        dataDir?: string,
    ) {
        super(store, options, dataDir);
        this.getWsServer = getWsServer;
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const commitChat = payload.context?.commitChat;
        const commitHash = commitChat?.commitHash ?? '';
        const wsId = payload.workspaceId;

        const parentHash = await resolveParentHash(commitHash, workingDirectory);

        // Build tools first so we can route the aggregated tool-guidance prose
        // into the system message via `.appendToolGuidance()`.
        const tools: Tool<unknown>[] = [];
        let toolGuidance = '';

        // Inject add_diff_comment tool when we have enough context
        if (this.dataDir && wsId && commitHash && workingDirectory) {
            const manager = new DiffCommentsManager(this.dataDir);
            const { tool } = createAddDiffCommentTool({
                manager,
                workspaceId: wsId,
                commitHash,
                parentHash,
                workingDirectory,
                getWsServer: this.getWsServer,
            });
            tools.push(tool);
            toolGuidance += ADD_DIFF_COMMENT_SUFFIX;
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

        const { tools: filteredTools, toolGuidance: filteredGuidance } = applyLlmToolPreferences(
            [followUp, searchConversations, tavilySearch],
            disabledLlmTools,
        );

        tools.push(...filteredTools);
        toolGuidance += filteredGuidance;

        const systemMessage = await systemMessageBuilder()
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            .withBaseRepoInstructions(workingDirectory)
            .append(buildSourceLocationMarkdownLinkSystemMessage(payload.provider ?? this.provider)?.content)
            .appendToolGuidance(toolGuidance)
            .build();

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prependChatModeDirective(
                prompt,
                buildChatModeDirective({
                    mode: 'ask',
                    modeInstructions: await loadChatModeInstructions(workingDirectory, 'ask'),
                }),
            ),
            dispose: undefined,
        };
    }
}

// ============================================================================
// Helpers
// ============================================================================

const ADD_DIFF_COMMENT_SUFFIX =
    '\n\nYou have access to the `add_diff_comment` tool. ' +
    'Use it to leave review comments anchored to specific lines in the commit diff. ' +
    'When you identify bugs, issues, suggestions, or noteworthy patterns, call this tool ' +
    'with the file path, line numbers, and your comment. The comment will appear in the ' +
    'diff review panel for the user to browse and manage.';

/**
 * Resolve the parent commit hash for a given commit.
 *
 * An initial commit, an unreadable repository or a missing commit all answer
 * with the empty string, which is how the caller spells "no parent". Runs in
 * the native addon rather than blocking the event loop.
 *
 * Exported so its behaviour can be pinned against a real repository; the
 * executor's own suite mocks `fs` module-wide and cannot build one.
 */
export async function resolveParentHash(
    commitHash: string,
    workingDirectory: string | undefined,
): Promise<string> {
    if (!workingDirectory || !commitHash) return '';
    try {
        const parents = (
            await execGitAsync(['log', '--pretty=%P', '-n1', commitHash], workingDirectory, {
                timeout: 5000,
            })
        ).trim();
        // Use first parent (handles merge commits)
        const firstParent = parents.split(/\s+/)[0];
        return firstParent || '';
    } catch (err: unknown) {
        // Every other failure here means "no parent", but a stale or missing
        // addon means "no answer" — swallowing it would hand the diff-comment
        // tool an empty parent and render the whole commit as added lines.
        if (err instanceof NativeAddonLoadError) {
            throw err;
        }
        return '';
    }
}
