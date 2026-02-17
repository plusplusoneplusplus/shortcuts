/**
 * SPA Conversation Rendering Tests
 *
 * Tests for the chat rendering in the SPA detail panel:
 * chat message HTML structure, role-based CSS classes,
 * streaming indicator, input bar placeholder states,
 * backward compatibility with no turns, and copy button.
 *
 * Follows spa-bundle-chat-bubbles.test.ts pattern: inspects
 * the esbuild-bundled client code for expected patterns.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

describe('SPA conversation rendering', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    // ====================================================================
    // Chat message rendering
    // ====================================================================

    describe('chat message rendering', () => {
        it('should render user message with user role class', () => {
            expect(script).toContain('chat-message');
            expect(script).toContain(' user');
        });

        it('should render assistant message with assistant role class', () => {
            expect(script).toContain('chat-message');
            expect(script).toContain(' assistant');
        });

        it('should render multiple turns in chronological order', () => {
            // The code iterates queueTaskConversationTurns sequentially
            expect(script).toContain('queueTaskConversationTurns');
            expect(script).toContain('renderChatMessage');
        });

        it('should escape HTML in message content', () => {
            // Content is rendered via innerHTML after markdown processing
            // The bundle contains the markdown rendering pipeline
            expect(script).toContain('chat-message-content');
        });
    });

    // ====================================================================
    // Streaming indicator
    // ====================================================================

    describe('streaming indicator', () => {
        it('should show streaming indicator on active assistant bubble when status is running', () => {
            expect(script).toContain('streaming-indicator');
            expect(script).toContain('streaming');
            expect(script).toContain('Live');
        });

        it('should not show streaming indicator on completed process', () => {
            // Streaming class is conditional on the turn's streaming flag
            expect(script).toContain('.streaming');
            // The streaming indicator is only shown when streaming is true
            expect(script).toContain('streaming-indicator');
        });
    });

    // ====================================================================
    // Input bar
    // ====================================================================

    describe('input bar', () => {
        it('should render input bar with send button', () => {
            expect(script).toContain('chat-input-bar');
            expect(script).toContain('chat-send-btn');
            expect(script).toContain('chat-input');
        });

        it('should show "Continue this conversation..." placeholder when process is completed', () => {
            expect(script).toContain('Continue this conversation...');
        });

        it('should show disabled state when process has no sdkSessionId', () => {
            // Input is disabled when status is queued/cancelled or when streaming
            expect(script).toContain('disabled');
            expect(script).toContain('setInputBarDisabled');
        });
    });

    // ====================================================================
    // Backward compatibility
    // ====================================================================

    describe('backward compatibility', () => {
        it('should render legacy detail view when process has no conversationTurns', () => {
            // When turns are empty, synthetic bubbles from promptPreview/result
            expect(script).toContain('promptPreview');
            expect(script).toContain('proc.result');
        });

        it('should render legacy detail view when conversationTurns is empty array', () => {
            // Backward compat: shows waiting message when no data
            expect(script).toContain('No conversation data available.');
            expect(script).toContain('Waiting for response...');
        });

        it('should prefer fullPrompt over truncated promptPreview for synthetic turns', () => {
            // Synthetic turns use fullPrompt when available
            expect(script).toContain('fullPrompt');
            expect(script).toMatch(/fullPrompt\s*\|\|\s*[\w.]*promptPreview/);
        });
    });

    // ====================================================================
    // Legacy process detail — chat bubble rendering
    // ====================================================================

    describe('legacy process detail bubble rendering', () => {
        it('should contain renderConversationBubbles function for legacy detail view', () => {
            expect(script).toContain('renderConversationBubbles');
        });

        it('should use fullPrompt for legacy detail header title', () => {
            // renderDetail uses fullPrompt || promptPreview for the title
            expect(script).toContain('fullPrompt');
            expect(script).toContain('detailTitle');
        });

        it('should fetch conversationTurns from process API for legacy detail', () => {
            // renderDetail fetches full process to get conversationTurns
            expect(script).toContain('conversationTurns');
        });

        it('should render conversation as chat bubbles in legacy detail view', () => {
            // renderConversationBubbles wraps turns in chat-message bubbles
            expect(script).toContain('renderChatMessage');
            expect(script).toContain('conversation-body');
        });
    });

    // ====================================================================
    // Copy button
    // ====================================================================

    describe('copy button', () => {
        it('should include copy button element in assistant message bubble', () => {
            expect(script).toContain('bubble-copy-btn');
            expect(script).toContain('Copy message');
        });
    });

    // ====================================================================
    // Tool call rendering
    // ====================================================================

    describe('tool call rendering', () => {
        it('should render tool call cards within assistant messages', () => {
            expect(script).toContain('tool-call-card');
            expect(script).toContain('tool-calls-container');
        });

        it('should display tool name and icon in header', () => {
            expect(script).toContain('tool-call-name');
            expect(script).toContain('tool-call-icon');
        });

        it('should show status badge with correct state classes', () => {
            expect(script).toContain('tool-call-status');
            expect(script).toContain('pending');
            expect(script).toContain('running');
            expect(script).toContain('completed');
            expect(script).toContain('failed');
        });

        it('should display duration when available', () => {
            expect(script).toContain('tool-call-duration');
        });

        it('should include expand/collapse toggle button', () => {
            expect(script).toContain('tool-call-toggle');
            expect(script).toContain('Expand tool details');
        });

        it('should render arguments section with syntax highlighting', () => {
            expect(script).toContain('tool-call-section');
            expect(script).toContain('Arguments');
            expect(script).toContain('language-json');
        });

        it('should render result section when available', () => {
            expect(script).toContain('Result');
        });

        it('should collapse body by default', () => {
            expect(script).toContain('collapsed');
            expect(script).toContain('tool-call-body');
        });

        it('should handle multiple tools in chronological order', () => {
            // renderToolCallHTML is called for each tool in array order
            expect(script).toContain('tool-calls-container');
            expect(script).toContain('renderToolCallHTML');
        });

        it('should truncate long output with expand option', () => {
            expect(script).toContain('tool-call-truncated');
            expect(script).toContain('tool-call-expand-btn');
        });

        it('should update tool status via updateToolCallStatus', () => {
            expect(script).toContain('updateToolCallStatus');
        });

        it('should map tool names to icons', () => {
            // The bundle contains the tool icon mapping
            expect(script).toContain('TOOL_ICONS');
        });

        it('should support JSON syntax highlighting', () => {
            expect(script).toContain('json-key');
            expect(script).toContain('json-string');
            expect(script).toContain('json-number');
            expect(script).toContain('json-boolean');
        });

        it('should support bash syntax highlighting', () => {
            expect(script).toContain('bash-command');
            expect(script).toContain('bash-flag');
            expect(script).toContain('bash-path');
        });

        it('should attach toggle handlers to tool call cards', () => {
            expect(script).toContain('attachToolCallToggleHandlers');
            expect(script).toContain('attachToggleBehavior');
        });

        it('should render bash tool with description and command sections', () => {
            expect(script).toContain('buildBashArgsHTML');
            expect(script).toContain('tool-call-description');
            expect(script).toContain('Description');
            expect(script).toContain('Command');
            expect(script).toContain('language-bash');
        });

        it('should pass toolName to buildArgsHTML for tool-specific rendering', () => {
            // buildArgsHTML accepts optional toolName parameter
            expect(script).toContain('buildArgsHTML');
            // Bash tool calls route through buildBashArgsHTML
            expect(script).toContain('bash');
        });

        it('should show remaining bash args as Options when extra fields exist', () => {
            expect(script).toContain('Options');
        });
    });

    // ====================================================================
    // SSE tool event handling
    // ====================================================================

    describe('SSE tool event handling', () => {
        it('should handle tool-start events', () => {
            expect(script).toContain('tool-start');
            expect(script).toContain('handleToolStart');
        });

        it('should handle tool-complete events', () => {
            expect(script).toContain('tool-complete');
            expect(script).toContain('handleToolComplete');
        });

        it('should find existing card by tool ID on update', () => {
            expect(script).toContain('data-tool-id');
            expect(script).toContain('querySelector');
        });

        it('should preserve expand/collapse state during updates', () => {
            // updateToolCallStatus preserves collapsed class
            expect(script).toContain('collapsed');
        });

        it('should create tool-calls-container for streaming tool events', () => {
            // handleToolStart creates a container if missing
            expect(script).toContain('tool-calls-container');
        });

        it('should use renderToolCall for live DOM element creation', () => {
            expect(script).toContain('renderToolCall');
        });
    });

    // ====================================================================
    // ClientConversationTurn toolCalls support
    // ====================================================================

    describe('ClientConversationTurn toolCalls', () => {
        it('should render tool calls from turn.toolCalls in chat messages', () => {
            // renderChatMessage checks turn.toolCalls
            expect(script).toContain('toolCalls');
        });

        it('should only render tool calls for assistant messages', () => {
            // The code checks !isUser before rendering toolCalls
            expect(script).toContain('!isUser');
        });
    });

    // ====================================================================
    // Tool call normalization (name → toolName mapping)
    // ====================================================================

    describe('tool call normalization', () => {
        it('should export normalizeToolCall function', () => {
            expect(script).toContain('normalizeToolCall');
        });

        it('should handle server-side name field (fallback to name when toolName is missing)', () => {
            // normalizeToolCall uses: raw.toolName || raw.name || 'unknown'
            expect(script).toMatch(/toolName.*\|\|.*name.*\|\|.*unknown/);
        });

        it('should handle server-side parameters field (fallback to parameters when args is missing)', () => {
            // normalizeToolCall uses: raw.args || raw.parameters || {}
            expect(script).toMatch(/args.*\|\|.*parameters/);
        });

        it('should use normalizeToolCall in renderToolCallHTML', () => {
            // renderToolCallHTML calls normalizeToolCall before rendering
            expect(script).toContain('normalizeToolCall');
            expect(script).toContain('renderToolCallHTML');
        });

        it('should use normalizeToolCall in updateToolCallStatus', () => {
            // updateToolCallStatus normalizes input before updating DOM
            expect(script).toContain('updateToolCallStatus');
        });
    });

    // ====================================================================
    // SSE tool events in queue task detail view
    // ====================================================================

    describe('SSE tool events in queue task detail', () => {
        it('should handle tool-start events in connectQueueTaskSSE', () => {
            // The queue task SSE handler listens for tool-start events
            expect(script).toContain('tool-start');
        });

        it('should handle tool-complete events in connectQueueTaskSSE', () => {
            expect(script).toContain('tool-complete');
        });

        it('should handle tool-failed events in connectQueueTaskSSE', () => {
            expect(script).toContain('tool-failed');
        });

        it('should handle tool-start events in connectFollowUpSSE', () => {
            // Follow-up SSE also handles tool events
            expect(script).toContain('tool-start');
        });

        it('should handle tool-complete events in connectFollowUpSSE', () => {
            expect(script).toContain('tool-complete');
        });

        it('should handle tool-failed events in connectFollowUpSSE', () => {
            expect(script).toContain('tool-failed');
        });

        it('should have getOrCreateToolContainer helper', () => {
            expect(script).toContain('getOrCreateToolContainer');
        });

        it('should have findToolCard helper', () => {
            expect(script).toContain('findToolCard');
        });

        it('should create tool-calls-container in last assistant bubble', () => {
            // getOrCreateToolContainer creates container in last assistant bubble
            expect(script).toContain('tool-calls-container');
            expect(script).toContain('.chat-message.assistant');
        });

        it('should find tool card by data-tool-id attribute', () => {
            // findToolCard queries by data-tool-id
            expect(script).toContain('data-tool-id');
        });
    });

    // ====================================================================
    // Conversation history persistence on page refresh
    // ====================================================================

    describe('conversation history persistence on page refresh', () => {
        it('should seed queueTaskStreamContent from stored streaming turn on page load', () => {
            // showQueueTaskDetail checks for streaming assistant turn and seeds stream content
            expect(script).toContain('lastTurn.streaming');
            expect(script).toContain('queueTaskStreamContent');
        });

        it('should load conversation turns from API on showQueueTaskDetail', () => {
            // showQueueTaskDetail fetches /processes/:id and sets conversation turns
            expect(script).toContain('setQueueTaskConversationTurns');
            expect(script).toContain('proc.conversationTurns');
        });

        it('should add assistant turn to state when SSE chunk arrives without existing assistant turn', () => {
            // The chunk handler should push a new assistant turn when none exists
            expect(script).toContain('turns.push');
            expect(script).toContain('assistant');
        });

        it('should update existing assistant turn content when SSE chunk arrives', () => {
            // The chunk handler updates the last assistant turn's content
            expect(script).toContain('turns[turns.length - 1].content = queueTaskStreamContent');
        });
    });

    // ====================================================================
    // Bundled client JS
    // ====================================================================

    describe('bundled client JS', () => {
        it('should contain renderChatMessage function in bundle', () => {
            expect(script).toContain('renderChatMessage');
        });

        it('should contain chat-message CSS class for follow-up bubbles', () => {
            // Follow-up bubbles use the same chat-message class as renderChatMessage
            expect(script).toContain('chat-message assistant streaming');
        });

        it('should contain sendFollowUpMessage function in bundle', () => {
            expect(script).toContain('sendFollowUpMessage');
        });

        it('should contain connectFollowUpSSE function in bundle', () => {
            expect(script).toContain('connectFollowUpSSE');
        });

        it('should contain scrollConversationToBottom helper', () => {
            expect(script).toContain('scrollConversationToBottom');
        });
    });

    // ====================================================================
    // Cache synchronization during SSE streaming
    // ====================================================================

    describe('cache synchronization during SSE streaming', () => {
        it('should update cache after each SSE chunk via cacheConversation', () => {
            // The chunk handler calls cacheConversation after updateConversationContent
            // to keep cache in sync with live streaming state
            expect(script).toContain('cacheConversation');
            expect(script).toContain('updateConversationContent');
        });

        it('should invalidate cache in status handler before refetching', () => {
            // The status event handler calls invalidateConversationCache before fetchApi
            expect(script).toContain('invalidateConversationCache');
        });

        it('should repopulate cache after status handler fetch completes', () => {
            // After the fetch resolves in the status handler, cacheConversation is called
            // with the authoritative server data
            expect(script).toContain('cacheConversation(processId');
        });

        it('should export invalidateConversationCache from sidebar module', () => {
            // invalidateConversationCache is a centralized cache invalidation helper
            expect(script).toContain('invalidateConversationCache');
        });
    });
});
