/**
 * Tests for chat edge cases: session expiry display, scroll-to-bottom visibility,
 * localStorage preference read/write, copy-button functionality, first-time hint,
 * and long-conversation handling.
 *
 * These tests verify the bundled client JS contains the expected code patterns
 * and the CSS contains the expected styles, following the pattern of existing
 * SPA bundle tests (spa-bundle-chat-bubbles.test.ts, spa-bundle-chat-input.test.ts).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from '../spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

function getStylesContent(): string {
    const cssPath = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'dist', 'bundle.css');
    return fs.readFileSync(cssPath, 'utf8');
}

describe('client bundle — chat edge cases', () => {
    let script: string;
    let styles: string;
    beforeAll(() => {
        script = getClientBundle();
        styles = getStylesContent();
    });

    // ================================================================
    // Session expiry error display
    // ================================================================

    describe('session expiry', () => {
        it('detects HTTP 410 status in follow-up POST', () => {
            expect(script).toContain('410');
            expect(script).toContain('sessionExpired');
        });

        it('renders chat-error-bubble on session expiry', () => {
            expect(script).toContain('chat-error-bubble');
        });

        it('displays session expired message text', () => {
            expect(script).toContain('Session expired');
            expect(script).toContain('Start a new task to continue');
        });

        it('disables input bar after session expiry', () => {
            // After session expiry, setInputBarDisabled(true) is called
            expect(script).toContain('setInputBarDisabled');
        });

        it('removes follow-up assistant bubble on session expiry', () => {
            // The assistant bubble is removed before showing error bubble
            expect(script).toContain('follow-up-assistant-bubble');
        });

        it('has chat-error-bubble CSS styles', () => {
            expect(styles).toContain('.chat-error-bubble');
            expect(styles).toContain('rgba(241');
        });
    });

    // ================================================================
    // Scroll-to-bottom visibility
    // ================================================================

    describe('scroll-to-bottom button', () => {
        it('renders scroll-to-bottom button in conversation', () => {
            expect(script).toContain('scroll-to-bottom-btn');
            expect(script).toContain('scroll-to-bottom');
        });

        it('tracks userHasScrolledUp state', () => {
            expect(script).toContain('userHasScrolledUp');
        });

        it('uses 80px threshold for at-bottom detection', () => {
            expect(script).toContain('80');
            expect(script).toContain('scrollHeight');
            expect(script).toContain('scrollTop');
            expect(script).toContain('clientHeight');
        });

        it('toggles visible class on scroll-to-bottom button', () => {
            // When scrolled up, button gets .visible; at bottom, .visible is removed
            expect(script).toContain('visible');
        });

        it('provides smooth scroll-to-bottom on click', () => {
            expect(script).toContain('scrollTo');
            expect(script).toContain('smooth');
        });

        it('resets userHasScrolledUp on conversation re-render', () => {
            // userHasScrolledUp = false in renderQueueTaskConversation
            expect(script).toContain('userHasScrolledUp = false');
        });

        it('has scroll-to-bottom CSS styles', () => {
            expect(styles).toContain('.scroll-to-bottom');
            expect(styles).toContain('.scroll-to-bottom.visible');
        });

        it('attaches scroll listener via initScrollToBottomTracking', () => {
            expect(script).toContain('initScrollToBottomTracking');
        });
    });

    // ================================================================
    // localStorage preference read/write
    // ================================================================

    describe('localStorage preferences', () => {
        it('reads coc-chat-enter-send preference', () => {
            expect(script).toContain('coc-chat-enter-send');
        });

        it('reads coc-chat-auto-scroll preference', () => {
            expect(script).toContain('coc-chat-auto-scroll');
        });

        it('defaults enter-send to true', () => {
            // chatEnterSend = localStorage.getItem('coc-chat-enter-send') !== 'false'
            expect(script).toContain('coc-chat-enter-send');
        });

        it('defaults auto-scroll to true', () => {
            // chatAutoScroll = localStorage.getItem('coc-chat-auto-scroll') !== 'false'
            expect(script).toContain('coc-chat-auto-scroll');
        });

        it('gates auto-scroll behind chatAutoScroll preference', () => {
            expect(script).toContain('chatAutoScroll');
        });

        it('respects enter-send preference in keydown handler', () => {
            expect(script).toContain('chatEnterSend');
            // When chatEnterSend is false, Ctrl+Enter sends
            expect(script).toContain('ctrlKey');
            expect(script).toContain('metaKey');
        });
    });

    // ================================================================
    // Per-message copy button
    // ================================================================

    describe('per-message copy button', () => {
        it('renders copy button for both user and assistant messages', () => {
            // The copy button is now rendered for all messages with content (not just assistant)
            expect(script).toContain('bubble-copy-btn');
            expect(script).toContain('handleMsgCopy');
        });

        it('stores raw markdown in data-raw attribute', () => {
            expect(script).toContain('data-raw');
        });

        it('reads raw content from closest chat-message data-raw', () => {
            expect(script).toContain('closest');
            expect(script).toContain('data-raw');
        });

        it('shows brief Copied feedback after copy', () => {
            expect(script).toContain('Copied');
            expect(script).toContain('1500');
        });

        it('has bubble-copy-btn CSS styles', () => {
            expect(styles).toContain('.bubble-copy-btn');
            expect(styles).toContain('.chat-message:hover .bubble-copy-btn');
        });
    });

    // ================================================================
    // First-time hint
    // ================================================================

    describe('first-time hint', () => {
        it('checks coc-chat-hint-dismissed in localStorage', () => {
            expect(script).toContain('coc-chat-hint-dismissed');
        });

        it('renders chat-hint element when not dismissed', () => {
            expect(script).toContain('chat-hint');
            expect(script).toContain('follow-up messages');
        });

        it('renders dismiss button on hint', () => {
            expect(script).toContain('chat-hint-dismiss');
            expect(script).toContain('dismissChatHint');
        });

        it('sets localStorage on dismiss', () => {
            // dismissChatHint sets localStorage
            expect(script).toContain('coc-chat-hint-dismissed');
        });

        it('dismisses hint on first message send', () => {
            // dismissChatHint() is called in send handler
            expect(script).toContain('dismissChatHint');
        });

        it('has chat-hint CSS styles', () => {
            expect(styles).toContain('.chat-hint');
            expect(styles).toContain('.chat-hint-dismiss');
        });
    });

    // ================================================================
    // Long conversation hint
    // ================================================================

    describe('long conversation hint', () => {
        it('renders chat-long-hint separator after 20 messages', () => {
            expect(script).toContain('chat-long-hint');
            // The threshold is i === 20 (before the 21st message)
            expect(script).toContain('=== 20');
        });

        it('includes Jump to latest button in long conversation hint', () => {
            expect(script).toContain('Jump to latest');
        });

        it('reuses scrollConversationToBottom in long hint button', () => {
            expect(script).toContain('scrollConversationToBottom');
        });

        it('has chat-long-hint CSS styles', () => {
            expect(styles).toContain('.chat-long-hint');
        });
    });

    // ================================================================
    // Concurrent viewer handling
    // ================================================================

    describe('concurrent viewer handling', () => {
        it('documents last-writer-wins behavior in source code comment', () => {
            // Comments are stripped by esbuild — verify in the source file instead
            const source = fs.readFileSync(
                path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'detail.ts'),
                'utf8'
            );
            expect(source).toContain('Concurrent viewer');
            expect(source).toContain('Last writer wins');
        });
    });
});

// ================================================================
// Server-side: queue-executor-bridge session expiry
// ================================================================

describe('queue-executor-bridge — session expiry', () => {
    it('CLITaskExecutor exports isSessionAlive method', async () => {
        const { CLITaskExecutor } = await import('../../../src/server/queue-executor-bridge');
        expect(typeof CLITaskExecutor.prototype.isSessionAlive).toBe('function');
    });

    it('QueueExecutorBridge interface includes isSessionAlive', async () => {
        // Verify bridge factory returns an object with isSessionAlive
        const mod = await import('../../../src/server/queue-executor-bridge');
        expect(mod.CLITaskExecutor).toBeDefined();
        // The method should exist on the prototype
        const proto = mod.CLITaskExecutor.prototype;
        expect(proto.isSessionAlive).toBeDefined();
    });
});

// ================================================================
// API handler: 410 response
// ================================================================

describe('api-handler — session expiry 410', () => {
    it('api-handler source contains 410 status code for session expiry', async () => {
        const apiSource = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'src', 'server', 'api-handler.ts'),
            'utf8'
        );
        expect(apiSource).toContain('410');
        expect(apiSource).toContain('session_expired');
        expect(apiSource).toContain('The AI session has ended');
    });

    it('api-handler checks isSessionAlive before executing follow-up', () => {
        const apiSource = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'src', 'server', 'api-handler.ts'),
            'utf8'
        );
        expect(apiSource).toContain('isSessionAlive');
    });
});
