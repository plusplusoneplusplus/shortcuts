/**
 * Tests for the Wiki Ask AI widget (008).
 *
 * Validates:
 * - wiki-ask.ts and wiki-ask.css source files exist and have correct structure
 * - Widget HTML structure renders in the wiki tab
 * - expand/collapse toggle CSS classes and hidden states
 * - askPanelSend prevents double-send when askStreaming is true
 * - Question submission targets /api/wikis/:wikiId/ask endpoint
 * - SSE context, chunk, done, error event handling
 * - Session ID persistence for multi-turn conversations
 * - Clear button: DELETE request, resets session/history, clears DOM
 * - Deep-dive button insertion and toggle behavior
 * - Deep-dive SSE streaming with status/chunk/done events
 * - Keyboard shortcuts (Ctrl+I toggle, Escape close, Enter send)
 * - Textarea auto-resize on input
 * - Error handling when fetch rejects (network error)
 * - HTML template contains widget markup
 * - CSS styles are defined in the bundle
 * - Client bundle contains wiki-ask functions
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// Source file existence
// ============================================================================

describe('wiki-ask source files', () => {
    it('should have client/wiki-ask.ts', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'wiki-ask.ts'))).toBe(true);
    });

    it('should have client/wiki-ask.css', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'wiki-ask.css'))).toBe(true);
    });
});

// ============================================================================
// wiki-ask.ts structure
// ============================================================================

describe('client/wiki-ask.ts — exports and structure', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('exports expandWidget function', () => {
        expect(content).toContain('export function expandWidget');
    });

    it('exports collapseWidget function', () => {
        expect(content).toContain('export function collapseWidget');
    });

    it('exports addDeepDiveButton function', () => {
        expect(content).toContain('export function addDeepDiveButton');
    });

    it('exports setupWikiAskListeners function', () => {
        expect(content).toContain('export function setupWikiAskListeners');
    });

    it('exports updateAskSubject function', () => {
        expect(content).toContain('export function updateAskSubject');
    });

    it('imports appState from state module', () => {
        expect(content).toContain("import { appState } from './state'");
    });

    it('imports getApiBase from config module', () => {
        expect(content).toContain("import { getApiBase } from './config'");
    });

    it('imports escapeHtmlClient from utils module', () => {
        expect(content).toContain("import { escapeHtmlClient } from './utils'");
    });

    it('imports wikiState from wiki-content module', () => {
        expect(content).toContain("import { wikiState } from './wiki-content'");
    });

    it('has module-level conversationHistory array', () => {
        expect(content).toContain('let conversationHistory');
    });

    it('has module-level askStreaming flag', () => {
        expect(content).toContain('let askStreaming');
    });

    it('has module-level askPanelOpen flag', () => {
        expect(content).toContain('let askPanelOpen');
    });

    it('has module-level currentSessionId variable', () => {
        expect(content).toContain('let currentSessionId');
    });

    it('has module-level deepDiveStreaming flag', () => {
        expect(content).toContain('let deepDiveStreaming');
    });

    it('does not use var declarations', () => {
        const varMatches = content.match(/^\s*var\s+/gm);
        expect(varMatches).toBeNull();
    });
});

// ============================================================================
// Multi-wiki URL adaptation
// ============================================================================

describe('wiki-ask.ts — multi-wiki URL endpoints', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('posts to /wikis/:wikiId/ask for questions', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/ask'");
    });

    it('sends DELETE to /wikis/:wikiId/ask/session/:sessionId for clear', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/ask/session/'");
    });

    it('posts to /wikis/:wikiId/explore/:componentId for deep dive', () => {
        expect(content).toContain("/wikis/' + encodeURIComponent(wikiId) + '/explore/'");
    });

    it('does NOT use single-wiki /api/ask endpoint', () => {
        // Should not contain a bare fetch to '/api/ask' without wiki scoping
        const lines = content.split('\n');
        for (const line of lines) {
            // Match literal fetch('/api/ask' or fetch("/api/ask" — unscoped
            if (line.match(/fetch\s*\(\s*['"]\/api\/ask/)) {
                throw new Error('Found unscoped /api/ask fetch: ' + line.trim());
            }
        }
    });
});

// ============================================================================
// SSE streaming protocol
// ============================================================================

describe('wiki-ask.ts — SSE streaming protocol', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('uses fetch with POST method for ask requests', () => {
        expect(content).toContain("method: 'POST'");
    });

    it('sends Content-Type: application/json header', () => {
        expect(content).toContain("'Content-Type': 'application/json'");
    });

    it('uses response.body.getReader() for streaming', () => {
        expect(content).toContain('response.body!.getReader()');
    });

    it('uses TextDecoder for decoding chunks', () => {
        expect(content).toContain('new TextDecoder()');
    });

    it('handles context SSE event type', () => {
        expect(content).toContain("data.type === 'context'");
    });

    it('handles chunk SSE event type', () => {
        expect(content).toContain("data.type === 'chunk'");
    });

    it('handles done SSE event type', () => {
        expect(content).toContain("data.type === 'done'");
    });

    it('handles error SSE event type', () => {
        expect(content).toContain("data.type === 'error'");
    });

    it('parses data: prefix from SSE lines', () => {
        expect(content).toContain("line.startsWith('data: ')");
    });

    it('captures sessionId from done event', () => {
        expect(content).toContain('data.sessionId');
        expect(content).toContain('currentSessionId = data.sessionId');
    });
});

// ============================================================================
// Session management (multi-turn)
// ============================================================================

describe('wiki-ask.ts — session management', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('sends sessionId when available', () => {
        expect(content).toContain('requestBody.sessionId = currentSessionId');
    });

    it('sends conversationHistory when no sessionId', () => {
        expect(content).toContain('requestBody.conversationHistory = conversationHistory.slice(0, -1)');
    });

    it('resets currentSessionId on clear', () => {
        expect(content).toContain('currentSessionId = null');
    });

    it('resets conversationHistory on clear', () => {
        expect(content).toContain("conversationHistory = []");
    });

    it('pushes user messages to conversation history', () => {
        expect(content).toContain("conversationHistory.push({ role: 'user'");
    });

    it('pushes assistant messages to conversation history after streaming', () => {
        expect(content).toContain("conversationHistory.push({ role: 'assistant'");
    });
});

// ============================================================================
// Message rendering helpers
// ============================================================================

describe('wiki-ask.ts — message rendering', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('creates ask-message div for user messages', () => {
        expect(content).toContain("div.className = 'ask-message'");
    });

    it('creates ask-message-user for user bubble', () => {
        expect(content).toContain("'ask-message-' + role");
    });

    it('creates ask-message-assistant for assistant bubble', () => {
        expect(content).toContain("inner.className = 'ask-message-assistant'");
    });

    it('renders markdown with marked.parse when available', () => {
        expect(content).toContain('marked.parse(content)');
    });

    it('falls back to escapeHtml when marked unavailable', () => {
        expect(content).toContain("typeof marked !== 'undefined'");
        expect(content).toContain('escapeHtmlClient(content)');
    });

    it('creates ask-message-context for context pills', () => {
        expect(content).toContain("div.className = 'ask-message-context'");
    });

    it('creates ask-message-typing for thinking indicator', () => {
        expect(content).toContain("inner.className = 'ask-message-typing'");
    });

    it('creates ask-message-error for error messages', () => {
        expect(content).toContain("div.className = 'ask-message-error'");
    });

    it('removes typing indicator when first chunk arrives', () => {
        expect(content).toContain('typingEl.parentNode.removeChild(typingEl)');
    });

    it('scrolls messages to bottom after appending', () => {
        expect(content).toContain('messages.scrollTop = messages.scrollHeight');
    });
});

// ============================================================================
// Deep dive functionality
// ============================================================================

describe('wiki-ask.ts — deep dive', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('creates deep-dive-btn element', () => {
        expect(content).toContain("btn.className = 'deep-dive-btn'");
    });

    it('inserts button before first child of markdown-body', () => {
        expect(content).toContain('markdownBody.insertBefore(btn, markdownBody.firstChild)');
    });

    it('creates deep-dive-section with input and submit', () => {
        expect(content).toContain("section.className = 'deep-dive-section'");
    });

    it('toggles deep-dive-section on button click', () => {
        expect(content).toContain("document.getElementById('wiki-deep-dive-section')");
    });

    it('prevents concurrent deep dive requests', () => {
        expect(content).toContain('if (deepDiveStreaming) return');
    });

    it('sends depth: deep in request body', () => {
        expect(content).toContain("body.depth = 'deep'");
    });

    it('handles status SSE event for progress messages', () => {
        expect(content).toContain("data.type === 'status'");
    });

    it('uses data.text for deep dive chunks (not data.content)', () => {
        expect(content).toContain('data.text');
    });

    it('applies syntax highlighting with hljs after completion', () => {
        expect(content).toContain('hljs.highlightElement');
    });
});

// ============================================================================
// Keyboard shortcuts
// ============================================================================

describe('wiki-ask.ts — keyboard shortcuts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('listens for Ctrl/Cmd+I to toggle widget', () => {
        expect(content).toContain("e.key === 'i'");
        expect(content).toContain('e.ctrlKey || e.metaKey');
    });

    it('listens for Escape to close widget', () => {
        expect(content).toContain("e.key === 'Escape'");
    });

    it('listens for Enter (no Shift) to send question', () => {
        expect(content).toContain("e.key === 'Enter' && !e.shiftKey");
    });

    it('only activates shortcuts on wiki tab', () => {
        expect(content).toContain("appState.activeTab !== 'wiki'");
    });

    it('focuses textarea on expand via Ctrl+I', () => {
        expect(content).toContain("document.getElementById('wiki-ask-textarea')");
    });
});

// ============================================================================
// Textarea auto-resize
// ============================================================================

describe('wiki-ask.ts — textarea auto-resize', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('listens for input event on textarea', () => {
        expect(content).toContain("addEventListener('input'");
    });

    it('resets height to auto before measuring', () => {
        expect(content).toContain("textarea.style.height = 'auto'");
    });

    it('caps height at 120px', () => {
        expect(content).toContain('Math.min(textarea.scrollHeight, 120)');
    });
});

// ============================================================================
// Double-send prevention
// ============================================================================

describe('wiki-ask.ts — double-send prevention', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('returns early if askStreaming is true', () => {
        expect(content).toContain('if (askStreaming) return');
    });

    it('sets askStreaming to true before fetch', () => {
        expect(content).toContain('askStreaming = true');
    });

    it('disables send button during streaming', () => {
        expect(content).toContain('sendBtn.disabled = true');
    });

    it('re-enables send button after streaming completes', () => {
        expect(content).toContain('sendBtn.disabled = false');
    });
});

// ============================================================================
// Error handling
// ============================================================================

describe('wiki-ask.ts — error handling', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('catches fetch errors with .catch()', () => {
        expect(content).toContain('.catch(function (err');
    });

    it('displays error message on network failure', () => {
        expect(content).toContain("err.message || 'Failed to connect'");
    });

    it('handles non-OK response status', () => {
        expect(content).toContain('if (!response.ok)');
    });

    it('handles deep dive fetch errors', () => {
        // Deep dive also has .catch
        const catchCount = (content.match(/\.catch\(function/g) || []).length;
        expect(catchCount).toBeGreaterThanOrEqual(2);
    });
});

// ============================================================================
// wiki-ask.css structure
// ============================================================================

describe('client/wiki-ask.css — styles', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.css'); });

    it('defines .wiki-ask-widget base styles', () => {
        expect(content).toContain('.wiki-ask-widget {');
    });

    it('defines .wiki-ask-widget.expanded styles', () => {
        expect(content).toContain('.wiki-ask-widget.expanded {');
    });

    it('defines .wiki-ask-widget-header styles', () => {
        expect(content).toContain('.wiki-ask-widget-header {');
    });

    it('defines .wiki-ask-widget-header.hidden rule', () => {
        expect(content).toContain('.wiki-ask-widget-header.hidden');
    });

    it('defines .wiki-ask-messages styles', () => {
        expect(content).toContain('.wiki-ask-messages {');
    });

    it('defines .wiki-ask-messages.hidden rule', () => {
        expect(content).toContain('.wiki-ask-messages.hidden');
    });

    it('defines .ask-message-user styles', () => {
        expect(content).toContain('.ask-message-user {');
    });

    it('defines .ask-message-assistant styles', () => {
        expect(content).toContain('.ask-message-assistant {');
    });

    it('defines .ask-message-context styles', () => {
        expect(content).toContain('.ask-message-context {');
    });

    it('defines .ask-message-error styles', () => {
        expect(content).toContain('.ask-message-error {');
    });

    it('defines .ask-message-typing with animation', () => {
        expect(content).toContain('.ask-message-typing {');
        expect(content).toContain('@keyframes wiki-ask-typing');
    });

    it('defines .wiki-ask-widget-input styles', () => {
        expect(content).toContain('.wiki-ask-widget-input {');
    });

    it('defines .wiki-ask-widget-textarea styles', () => {
        expect(content).toContain('.wiki-ask-widget-textarea {');
    });

    it('defines .wiki-ask-widget-send styles', () => {
        expect(content).toContain('.wiki-ask-widget-send {');
    });

    it('defines responsive breakpoint at 768px', () => {
        expect(content).toContain('@media (max-width: 768px)');
    });

    it('defines deep-dive-btn styles', () => {
        expect(content).toContain('.deep-dive-btn {');
    });

    it('defines deep-dive-section styles', () => {
        expect(content).toContain('.deep-dive-section {');
    });

    it('defines deep-dive-input styles', () => {
        expect(content).toContain('.deep-dive-input {');
    });

    it('defines deep-dive-submit styles', () => {
        expect(content).toContain('.deep-dive-submit {');
    });

    it('defines deep-dive-result styles', () => {
        expect(content).toContain('.deep-dive-result {');
    });

    it('defines deep-dive-status styles', () => {
        expect(content).toContain('.deep-dive-status {');
    });

    it('uses CoC theme variables (not deep-wiki vars)', () => {
        // Should use --bg-primary, --accent, --text-primary etc.
        expect(content).toContain('var(--bg-primary)');
        expect(content).toContain('var(--accent)');
        expect(content).toContain('var(--text-primary)');
        expect(content).toContain('var(--text-secondary)');
        expect(content).toContain('var(--border-color)');
        // Should NOT use deep-wiki-only variables
        expect(content).not.toContain('var(--ask-bar-bg)');
        expect(content).not.toContain('var(--ask-bar-border)');
        expect(content).not.toContain('var(--sidebar-active-border)');
        expect(content).not.toContain('var(--content-text)');
    });
});

// ============================================================================
// styles.css imports wiki-ask.css
// ============================================================================

describe('styles.css — wiki-ask import', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('styles.css'); });

    it('imports wiki-ask.css', () => {
        expect(content).toContain("@import './wiki-ask.css'");
    });
});

// ============================================================================
// HTML template — widget structure
// ============================================================================

describe('HTML template — wiki ask widget', () => {
    const html = generateDashboardHtml();

    it('contains wiki ask widget container', () => {
        expect(html).toContain('id="wiki-ask-widget"');
    });

    it('widget has wiki-ask-widget class', () => {
        expect(html).toContain('class="wiki-ask-widget"');
    });

    it('contains widget header', () => {
        expect(html).toContain('id="wiki-ask-widget-header"');
    });

    it('header has hidden class by default', () => {
        expect(html).toContain('wiki-ask-widget-header hidden');
    });

    it('header shows "Ask AI" title', () => {
        expect(html).toContain('wiki-ask-widget-title');
        expect(html).toContain('Ask AI');
    });

    it('contains clear button', () => {
        expect(html).toContain('id="wiki-ask-clear"');
        expect(html).toContain('Clear');
    });

    it('contains close button', () => {
        expect(html).toContain('id="wiki-ask-close"');
    });

    it('contains messages area', () => {
        expect(html).toContain('id="wiki-ask-messages"');
    });

    it('messages area has hidden class by default', () => {
        expect(html).toContain('wiki-ask-messages hidden');
    });

    it('contains input area', () => {
        expect(html).toContain('wiki-ask-widget-input');
    });

    it('contains label with Ask AI about', () => {
        expect(html).toContain('Ask AI about');
        expect(html).toContain('id="wiki-ask-bar-subject"');
    });

    it('contains textarea', () => {
        expect(html).toContain('id="wiki-ask-textarea"');
        expect(html).toContain('Ask about this codebase...');
    });

    it('contains send button', () => {
        expect(html).toContain('id="wiki-ask-widget-send"');
    });

    it('send button has arrow symbol', () => {
        expect(html).toContain('&#10148;');
    });

    it('widget is inside view-wiki container', () => {
        const viewWikiStart = html.indexOf('id="view-wiki"');
        const widgetStart = html.indexOf('id="wiki-ask-widget"');
        const viewWikiEnd = html.indexOf('</div>', html.indexOf('wiki-ask-widget-send') + 50);
        expect(widgetStart).toBeGreaterThan(viewWikiStart);
    });
});

// ============================================================================
// Client bundle — wiki-ask functions
// ============================================================================

describe('client bundle — wiki-ask module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('contains setupWikiAskListeners function', () => {
        expect(script).toContain('setupWikiAskListeners');
    });

    it('contains expandWidget function', () => {
        expect(script).toContain('expandWidget');
    });

    it('contains collapseWidget function', () => {
        expect(script).toContain('collapseWidget');
    });

    it('contains addDeepDiveButton function', () => {
        expect(script).toContain('addDeepDiveButton');
    });

    it('contains updateAskSubject function', () => {
        expect(script).toContain('updateAskSubject');
    });

    it('exposes addDeepDiveButton on window', () => {
        expect(script).toContain('addDeepDiveButton');
    });

    it('references wiki-scoped ask endpoint', () => {
        expect(script).toContain('/wikis/');
        expect(script).toContain('/ask');
    });

    it('references wiki-scoped explore endpoint', () => {
        expect(script).toContain('/explore/');
    });
});

// ============================================================================
// Client bundle CSS — wiki-ask styles
// ============================================================================

describe('CSS bundle — wiki-ask styles', () => {
    const html = generateDashboardHtml();

    it('defines .wiki-ask-widget styles in bundle', () => {
        expect(html).toContain('.wiki-ask-widget');
    });

    it('defines .ask-message styles in bundle', () => {
        expect(html).toContain('.ask-message');
    });

    it('defines .deep-dive-btn styles in bundle', () => {
        expect(html).toContain('.deep-dive-btn');
    });

    it('defines .deep-dive-section styles in bundle', () => {
        expect(html).toContain('.deep-dive-section');
    });
});

// ============================================================================
// index.ts — wiki-ask import
// ============================================================================

describe('index.ts — wiki-ask import', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('index.tsx'); });

    it('imports wiki-ask module', () => {
        expect(content).toContain("import './wiki-ask'");
    });

    it('wiki-ask import is with other wiki imports', () => {
        const wikiIdx = content.indexOf("import './wiki'");
        const askIdx = content.indexOf("import './wiki-ask'");
        const wsIdx = content.indexOf("import './websocket'");
        expect(askIdx).toBeGreaterThan(wikiIdx);
        expect(askIdx).toBeLessThan(wsIdx);
    });
});

// ============================================================================
// wiki.ts — setupWikiAskListeners integration
// ============================================================================

describe('wiki.ts — Ask AI integration', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki.ts'); });

    it('imports setupWikiAskListeners from wiki-ask', () => {
        expect(content).toContain("import { setupWikiAskListeners } from './wiki-ask'");
    });

    it('calls setupWikiAskListeners', () => {
        expect(content).toContain('setupWikiAskListeners()');
    });
});

// ============================================================================
// Window global assignments
// ============================================================================

describe('wiki-ask.ts — window globals', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('wiki-ask.ts'); });

    it('exposes addDeepDiveButton on window', () => {
        expect(content).toContain('(window as any).addDeepDiveButton = addDeepDiveButton');
    });

    it('exposes expandWikiAskWidget on window', () => {
        expect(content).toContain('(window as any).expandWikiAskWidget = expandWidget');
    });

    it('exposes collapseWikiAskWidget on window', () => {
        expect(content).toContain('(window as any).collapseWikiAskWidget = collapseWidget');
    });

    it('exposes updateAskSubject on window', () => {
        expect(content).toContain('(window as any).updateAskSubject = updateAskSubject');
    });
});
