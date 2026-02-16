/**
 * Tests for chat bubble rendering in the detail panel.
 *
 * Tests cover renderChatMessage HTML structure, backward compatibility
 * with legacy process data, streaming bubble targeting, and collapsible metadata.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

function getStylesContent(): string {
    const cssPath = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'dist', 'bundle.css');
    return fs.readFileSync(cssPath, 'utf8');
}

describe('client bundle — chat bubble rendering', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    // ---- renderChatMessage presence ----

    it('defines renderChatMessage function', () => {
        expect(script).toContain('renderChatMessage');
    });

    it('renderChatMessage produces user bubble classes', () => {
        // The function builds "chat-message" + " user" for user turns
        expect(script).toContain('chat-message');
        expect(script).toContain(' user');
        expect(script).toContain(' assistant');
    });

    it('renderChatMessage includes role icons', () => {
        // Emojis may be escape-encoded in the bundle
        expect(script).toContain('1F464');
        expect(script).toContain('1F916');
    });

    it('renderChatMessage includes role labels You and Assistant', () => {
        expect(script).toContain('You');
        expect(script).toContain('Assistant');
    });

    it('renderChatMessage renders timestamp when available', () => {
        expect(script).toContain('toLocaleTimeString');
        expect(script).toContain('timestamp');
    });

    it('renderChatMessage renders streaming indicator for streaming turns', () => {
        expect(script).toContain('streaming-indicator');
        // ● may be escape-encoded as 25CF in the bundle
        expect(script).toContain('25CF');
        expect(script).toContain('Live');
    });

    it('renderChatMessage renders copy button only for assistant', () => {
        expect(script).toContain('bubble-copy-btn');
        expect(script).toContain('Copy message');
    });

    it('renderChatMessage wraps content in chat-message-content', () => {
        expect(script).toContain('chat-message-content');
    });

    it('renderChatMessage wraps header in chat-message-header', () => {
        expect(script).toContain('chat-message-header');
    });

    // ---- Conversation turn iteration ----

    it('iterates queueTaskConversationTurns for bubble rendering', () => {
        expect(script).toContain('queueTaskConversationTurns');
        expect(script).toContain('renderChatMessage');
    });

    // ---- Backward compatibility ----

    it('renders synthetic user bubble from promptPreview for backward compat', () => {
        // When turns empty + proc.result, build synthetic user bubble from promptPreview
        expect(script).toContain('promptPreview');
        expect(script).toContain('role');
    });

    it('renders synthetic assistant bubble from result for backward compat', () => {
        expect(script).toContain('proc.result');
    });

    it('shows waiting message when no conversation data', () => {
        expect(script).toContain('Waiting for response...');
        expect(script).toContain('No conversation data available.');
    });

    // ---- Streaming update targets correct bubble ----

    it('updateConversationContent targets last assistant bubble', () => {
        expect(script).toContain('.chat-message.assistant');
        expect(script).toContain('.chat-message-content');
        expect(script).toContain('insertAdjacentHTML');
    });

    // ---- Collapsible metadata ----

    it('wraps metadata in details element with meta-section class', () => {
        expect(script).toContain('meta-section');
        expect(script).toContain('meta-summary');
        expect(script).toContain('<details');
        expect(script).toContain('</details>');
    });

    it('metadata summary shows process ID and model', () => {
        expect(script).toContain('meta-summary');
        expect(script).toContain('.metadata.model');
    });

    // ---- State management ----

    it('exports queueTaskConversationTurns state and setter', () => {
        expect(script).toContain('queueTaskConversationTurns');
        expect(script).toContain('setQueueTaskConversationTurns');
    });

    it('resets conversation turns on showQueueTaskDetail', () => {
        // setQueueTaskConversationTurns([]) called at start
        expect(script).toContain('setQueueTaskConversationTurns');
    });

    it('populates turns from proc.conversationTurns when available', () => {
        expect(script).toContain('conversationTurns');
    });

    // ---- SSE chunk handler updates turns ----

    it('SSE chunk handler updates last assistant turn content', () => {
        expect(script).toContain('queueTaskStreamContent');
        // The chunk handler sets streaming = true on last turn
        expect(script).toContain('.streaming');
    });

    it('SSE status handler marks streaming complete', () => {
        // When status event fires, streaming is set to false
        expect(script).toContain('.streaming');
    });

    // ---- CSS class presence ----

    it('streaming class applied to streaming bubbles', () => {
        expect(script).toContain(' streaming');
    });

    // ---- Follow-up optimistic UI uses correct chat-message class ----

    it('sendFollowUpMessage creates user bubble via renderChatMessage', () => {
        // The optimistic user bubble should use renderChatMessage (not raw chat-bubble class)
        expect(script).toContain('renderChatMessage(userTurn)');
    });

    it('sendFollowUpMessage creates assistant bubble with chat-message class', () => {
        // The optimistic assistant bubble must use "chat-message" (not "chat-bubble")
        expect(script).toContain('chat-message assistant streaming');
        // Must NOT use the old incorrect "chat-bubble" class for follow-up bubbles
        expect(script).not.toContain('chat-bubble user');
        expect(script).not.toContain('chat-bubble assistant');
    });

    it('sendFollowUpMessage assistant bubble has proper inner structure', () => {
        // The optimistic assistant bubble should have chat-message-header and chat-message-content
        expect(script).toContain('follow-up-assistant-bubble');
        expect(script).toContain('chat-message-header');
        expect(script).toContain('chat-message-content');
    });

    it('follow-up SSE chunk handler updates chat-message-content inside bubble', () => {
        // The SSE chunk handler should target .chat-message-content inside the bubble
        // rather than replacing the entire bubble innerHTML
        expect(script).toContain('.chat-message-content');
    });
});

// ================================================================
// Markdown rendering in chat bubbles
// ================================================================

describe('renderMarkdown in chat bubbles', () => {
    let script: string;
    let styles: string;
    beforeAll(() => {
        script = getClientBundle();
        styles = getStylesContent();
    });

    it('renderMarkdown function is defined in bundle', () => {
        expect(script).toContain('renderMarkdown');
    });

    it('renders fenced code blocks with pre and code tags', () => {
        expect(script).toContain('<pre><code');
    });

    it('renders language class on code blocks', () => {
        expect(script).toContain('language-');
    });

    it('renders headings h1 through h4', () => {
        expect(script).toContain('<h1');
        expect(script).toContain('<h2');
        expect(script).toContain('<h3');
        expect(script).toContain('<h4');
    });

    it('renders unordered lists with ul and li tags', () => {
        expect(script).toContain('<ul>');
        expect(script).toContain('<li>');
    });

    it('renders ordered lists with ol tag', () => {
        expect(script).toContain('<ol>');
    });

    it('renders blockquotes with blockquote tag', () => {
        expect(script).toContain('<blockquote>');
        expect(script).toContain('</blockquote>');
    });

    it('renders horizontal rules with hr tag', () => {
        expect(script).toContain('<hr>');
    });

    it('renders inline code with code tag via inlineFormat', () => {
        expect(script).toContain('<code>');
        expect(script).toContain('</code>');
    });

    it('renders bold text with strong tag', () => {
        expect(script).toContain('<strong>');
        expect(script).toContain('</strong>');
    });

    it('renders italic text with em tag', () => {
        expect(script).toContain('<em>');
        expect(script).toContain('</em>');
    });

    it('renders links with a tag and target="_blank"', () => {
        expect(script).toContain('<a href=');
        expect(script).toContain('target="_blank"');
    });

    it('links include rel="noopener" for security', () => {
        expect(script).toContain('rel="noopener"');
    });

    it('code block content is escaped via escapeHtmlClient', () => {
        expect(script).toContain('escapeHtmlClient(codeContent)');
    });

    it('inline code content is escaped via escapeHtmlClient', () => {
        expect(script).toContain('escapeHtmlClient(c)');
    });

    it('conversation-body has overflow-y auto for scrolling', () => {
        expect(styles).toContain('.conversation-body');
        expect(styles).toContain('overflow-y: auto');
    });

    it('conversation-body has word-wrap break-word for long content', () => {
        expect(styles).toContain('word-wrap: break-word');
    });

    it('conversation-body pre has overflow-x auto for wide code', () => {
        expect(styles).toContain('.conversation-body pre');
        expect(styles).toContain('overflow-x: auto');
    });
});
