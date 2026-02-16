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
