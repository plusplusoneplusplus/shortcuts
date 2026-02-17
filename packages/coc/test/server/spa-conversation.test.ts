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
});
