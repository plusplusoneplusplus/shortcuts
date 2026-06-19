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
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { execFileSync } from 'child_process';
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
    buildModeSystemMessage,
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
    applyLlmToolPreferences,
    buildSourceLocationMarkdownLinkSystemMessage,
} from './prompt-builder';
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

        // Resolve parent hash
        const parentHash = resolveParentHash(commitHash, workingDirectory);

        // Build auto-folder context (same pattern as ChatExecutor)
        let autoFolderContext = undefined;
        if (workingDirectory) {
            autoFolderContext = await this.buildAutoFolderContext(
                workingDirectory,
                wsId,
            );
        }

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
            .append(buildModeSystemMessage('ask')?.content)
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            .withRepoInstructions(workingDirectory, 'ask')
            .append(buildSourceLocationMarkdownLinkSystemMessage(payload.provider ?? this.provider)?.content)
            .appendToolGuidance(toolGuidance)
            .appendAutoFolder(autoFolderContext)
            .build();

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt,
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
 * Falls back to an empty-tree hash for initial commits.
 */
function resolveParentHash(commitHash: string, workingDirectory: string | undefined): string {
    if (!workingDirectory || !commitHash) return '';
    try {
        const parents = execFileSync(
            'git',
            ['log', '--pretty=%P', '-n1', commitHash],
            { cwd: workingDirectory, encoding: 'utf-8', timeout: 5000 },
        ).trim();
        // Use first parent (handles merge commits)
        const firstParent = parents.split(/\s+/)[0];
        return firstParent || '';
    } catch {
        return '';
    }
}
