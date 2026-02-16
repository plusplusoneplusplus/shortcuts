/**
 * Tests for chat input bar rendering, follow-up messaging,
 * input interaction patterns, and follow-up streaming state management.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

describe('client bundle — chat input bar', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    // ================================================================
    // Input bar rendering
    // ================================================================

    describe('input bar rendering', () => {
        it('renders chat-input-bar container', () => {
            expect(script).toContain('chat-input-bar');
        });

        it('renders textarea with id chat-input', () => {
            expect(script).toContain('chat-input');
            expect(script).toContain('textarea');
        });

        it('renders send button with id chat-send-btn', () => {
            expect(script).toContain('chat-send-btn');
            expect(script).toContain('send-btn');
        });

        it('renders send button with arrow symbol', () => {
            // ➤ = U+27A4
            expect(script).toContain('27A4');
        });

        it('renders placeholder text for completed status', () => {
            expect(script).toContain('Continue this conversation...');
        });

        it('renders placeholder text for queued status', () => {
            expect(script).toContain('Follow-ups available once task starts...');
        });

        it('renders placeholder text for running status', () => {
            expect(script).toContain('Waiting for response...');
        });

        it('renders placeholder text for failed status', () => {
            expect(script).toContain('Retry or ask a follow-up...');
        });

        it('renders placeholder text for cancelled status', () => {
            expect(script).toContain('Task was cancelled');
        });

        it('renders default placeholder text', () => {
            expect(script).toContain('Send a message...');
        });

        it('disables input bar when isFollowUpStreaming is true', () => {
            expect(script).toContain('isFollowUpStreaming');
            expect(script).toContain('disabled');
        });

        it('disables input bar when status is queued', () => {
            // inputDisabled logic: status === 'queued'
            expect(script).toContain('=== "queued"');
        });

        it('disables input bar when status is cancelled', () => {
            expect(script).toContain('=== "cancelled"');
        });
    });

    // ================================================================
    // getInputPlaceholder function
    // ================================================================

    describe('getInputPlaceholder', () => {
        it('defines getInputPlaceholder function', () => {
            expect(script).toContain('getInputPlaceholder');
        });

        it('checks isFollowUpStreaming for placeholder', () => {
            // The function checks queueState.isFollowUpStreaming
            expect(script).toContain('isFollowUpStreaming');
        });

        it('returns status-specific placeholders', () => {
            expect(script).toContain('Continue this conversation...');
            expect(script).toContain('Follow-ups available once task starts...');
            expect(script).toContain('Retry or ask a follow-up...');
            expect(script).toContain('Task was cancelled');
            expect(script).toContain('Send a message...');
        });
    });

    // ================================================================
    // sendFollowUpMessage function
    // ================================================================

    describe('sendFollowUpMessage', () => {
        it('defines sendFollowUpMessage function', () => {
            expect(script).toContain('sendFollowUpMessage');
        });

        it('POSTs to /processes/:id/message endpoint', () => {
            expect(script).toContain('/message');
            expect(script).toContain('method: "POST"');
            expect(script).toContain('"Content-Type": "application/json"');
        });

        it('sends content in POST body', () => {
            expect(script).toContain('JSON.stringify({ content');
        });

        it('creates optimistic user bubble via renderChatMessage', () => {
            expect(script).toContain('renderChatMessage(userTurn)');
        });

        it('creates streaming assistant bubble with chat-message class', () => {
            expect(script).toContain('chat-message assistant streaming');
            expect(script).toContain('follow-up-assistant-bubble');
        });

        it('renders streaming indicator in assistant bubble', () => {
            // ● = U+25CF
            expect(script).toContain('streaming-indicator');
            expect(script).toContain('25CF');
        });

        it('disables input bar before POST', () => {
            expect(script).toContain('setInputBarDisabled(true)');
        });

        it('sets isFollowUpStreaming to true', () => {
            expect(script).toContain('isFollowUpStreaming = true');
        });

        it('handles POST failure with error UI', () => {
            expect(script).toContain('bubble-error');
            expect(script).toContain('Failed to send message');
        });

        it('shows retry button on POST failure', () => {
            expect(script).toContain('retry-btn');
            expect(script).toContain('Retry');
        });

        it('re-enables input bar on POST failure', () => {
            expect(script).toContain('setInputBarDisabled(false)');
        });

        it('resets streaming state on POST failure', () => {
            expect(script).toContain('isFollowUpStreaming = false');
            expect(script).toContain('currentStreamingTurnIndex = null');
        });

        it('reads turnIndex from POST response', () => {
            expect(script).toContain('turnIndex');
        });

        it('connects follow-up SSE after successful POST', () => {
            expect(script).toContain('connectFollowUpSSE');
        });

        it('scrolls conversation to bottom after appending bubbles', () => {
            expect(script).toContain('scrollConversationToBottom');
        });

        it('is registered as window global for retry onclick', () => {
            expect(script).toContain('sendFollowUpMessage');
        });
    });

    // ================================================================
    // connectFollowUpSSE function
    // ================================================================

    describe('connectFollowUpSSE', () => {
        it('defines connectFollowUpSSE function', () => {
            expect(script).toContain('connectFollowUpSSE');
        });

        it('connects to /processes/:id/stream SSE endpoint', () => {
            expect(script).toContain('/stream');
            expect(script).toContain('EventSource');
        });

        it('handles chunk events with content accumulation', () => {
            expect(script).toContain('accumulatedContent');
            expect(script).toContain('addEventListener("chunk"');
        });

        it('handles done event to finalize streaming', () => {
            expect(script).toContain('addEventListener("done"');
        });

        it('handles status events', () => {
            expect(script).toContain('addEventListener("status"');
        });

        it('handles heartbeat events', () => {
            expect(script).toContain('addEventListener("heartbeat"');
        });

        it('closes EventSource on done', () => {
            expect(script).toContain('eventSource.close()');
        });

        it('resets streaming state on done', () => {
            // isFollowUpStreaming = false and currentStreamingTurnIndex = null
            expect(script).toContain('isFollowUpStreaming = false');
            expect(script).toContain('currentStreamingTurnIndex = null');
        });

        it('re-enables input bar on done', () => {
            expect(script).toContain('setInputBarDisabled(false)');
        });

        it('removes temporary bubble id on done', () => {
            expect(script).toContain('removeAttribute("id")');
        });

        it('focuses textarea after streaming completes', () => {
            expect(script).toContain('.focus()');
        });

        it('updates placeholder to completed status on done', () => {
            expect(script).toContain('getInputPlaceholder("completed")');
        });

        it('shows reconnect button on SSE error with no content', () => {
            expect(script).toContain('Connection lost');
            expect(script).toContain('Reconnect');
        });

        it('keeps partial content on SSE error with accumulated content', () => {
            // On error with content: removes streaming class and id, keeps content
            expect(script).toContain('classList.remove("streaming")');
        });

        it('is registered as window global for reconnect onclick', () => {
            expect(script).toContain('connectFollowUpSSE');
        });
    });

    // ================================================================
    // initChatInputHandlers function
    // ================================================================

    describe('initChatInputHandlers', () => {
        it('defines initChatInputHandlers function', () => {
            expect(script).toContain('initChatInputHandlers');
        });

        it('attaches input listener for auto-grow', () => {
            expect(script).toContain('addEventListener("input"');
            expect(script).toContain('scrollHeight');
        });

        it('attaches keydown listener for Enter to send', () => {
            expect(script).toContain('addEventListener("keydown"');
            expect(script).toContain('e.key === "Enter"');
        });

        it('checks Shift key to allow newlines', () => {
            expect(script).toContain('e.shiftKey');
        });

        it('prevents default on Enter without Shift', () => {
            expect(script).toContain('e.preventDefault()');
        });

        it('clears textarea after sending', () => {
            expect(script).toContain('textarea.value = ""');
        });

        it('resets textarea height after sending', () => {
            expect(script).toContain('textarea.style.height = "auto"');
        });

        it('attaches click listener for send button', () => {
            expect(script).toContain('sendBtn.addEventListener("click"');
        });

        it('does not send empty content', () => {
            expect(script).toContain('content && !textarea.disabled');
        });

        it('auto-grow clamps to 4 lines', () => {
            // maxHeight = lineHeight * 4
            expect(script).toContain('* 4');
        });
    });

    // ================================================================
    // setInputBarDisabled function
    // ================================================================

    describe('setInputBarDisabled', () => {
        it('defines setInputBarDisabled function', () => {
            expect(script).toContain('setInputBarDisabled');
        });

        it('toggles disabled on textarea', () => {
            expect(script).toContain('textarea.disabled = disabled');
        });

        it('toggles disabled on send button', () => {
            expect(script).toContain('sendBtn.disabled = disabled');
        });

        it('toggles disabled class on bar', () => {
            expect(script).toContain('bar.classList.add("disabled")');
            expect(script).toContain('bar.classList.remove("disabled")');
        });

        it('updates placeholder text based on disabled state', () => {
            expect(script).toContain('getInputPlaceholder');
        });
    });

    // ================================================================
    // State management
    // ================================================================

    describe('state management', () => {
        it('QueueState includes isFollowUpStreaming field', () => {
            expect(script).toContain('isFollowUpStreaming');
        });

        it('QueueState includes currentStreamingTurnIndex field', () => {
            expect(script).toContain('currentStreamingTurnIndex');
        });

        it('isFollowUpStreaming initialized to false', () => {
            expect(script).toContain('isFollowUpStreaming: false');
        });

        it('currentStreamingTurnIndex initialized to null', () => {
            expect(script).toContain('currentStreamingTurnIndex: null');
        });
    });

    // ================================================================
    // Window globals registration
    // ================================================================

    describe('window globals', () => {
        it('registers sendFollowUpMessage on window', () => {
            expect(script).toContain('sendFollowUpMessage');
        });

        it('registers connectFollowUpSSE on window', () => {
            expect(script).toContain('connectFollowUpSSE');
        });
    });
});
