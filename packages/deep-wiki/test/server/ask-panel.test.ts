/**
 * Tests for the Ask AI UI in the SPA template.
 *
 * The new DeepWiki-style UI has:
 *   - Bottom "Ask AI" bar (always visible when AI is enabled)
 *   - Slide-up "Ask Panel" overlay (opens on interaction)
 *   - No side panel or resize handle
 */

import { describe, it, expect } from 'vitest';
import { generateSpaHtml } from '../../src/server/spa-template';
import type { SpaTemplateOptions } from '../../src/server/spa-template';

// ============================================================================
// Helpers
// ============================================================================

function createOptions(overrides?: Partial<SpaTemplateOptions>): SpaTemplateOptions {
    return {
        theme: 'auto',
        title: 'Test Wiki',
        enableSearch: true,
        enableAI: true,
        enableGraph: false,
        ...overrides,
    };
}

// ============================================================================
// Ask Bottom Bar
// ============================================================================

describe('Ask Bottom Bar', () => {
    describe('when AI is enabled', () => {
        it('should include the ask bar element', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-bar"');
        });

        it('should include the ask bar label', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('Ask AI about');
            expect(html).toContain('id="ask-bar-subject"');
        });

        it('should include the bottom bar input', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-input"');
            expect(html).toContain('placeholder="Ask about this codebase..."');
        });

        it('should include the send button', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-send"');
        });

        it('should include the project title in subject', () => {
            const html = generateSpaHtml(createOptions({ title: 'MyProject' }));
            expect(html).toContain('MyProject');
        });
    });

    describe('when AI is disabled', () => {
        const opts = createOptions({ enableAI: false });

        it('should not include the ask bar', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-bar"');
        });

        it('should not include ask input', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-input"');
        });

        it('should not include ask send button', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-send"');
        });
    });
});

// ============================================================================
// Ask Panel (expanded chat overlay)
// ============================================================================

describe('Ask Panel', () => {
    describe('when AI is enabled', () => {
        it('should include the ask panel container', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-panel"');
            expect(html).toContain('class="ask-panel hidden"');
        });

        it('should include the messages area', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-messages"');
            expect(html).toContain('class="ask-messages"');
        });

        it('should include the textarea for input', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-textarea"');
        });

        it('should include the panel send button', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-panel-send"');
        });

        it('should include the close button', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-close"');
        });

        it('should include the clear conversation button', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-clear"');
            expect(html).toContain('Clear');
        });

        it('should include panel header', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('class="ask-panel-header"');
            expect(html).toContain('<h3>Ask AI</h3>');
        });

        it('should start hidden', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('class="ask-panel hidden"');
        });
    });

    describe('when AI is disabled', () => {
        const opts = createOptions({ enableAI: false });

        it('should not include the ask panel', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-panel"');
        });

        it('should not include ask messages area', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-messages"');
        });
    });
});

// ============================================================================
// CSS Styles
// ============================================================================

describe('Ask AI — CSS styles', () => {
    it('should include ask bar styles when AI is enabled', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('.ask-bar');
        expect(html).toContain('.ask-bar-input');
        expect(html).toContain('.ask-bar-send');
    });

    it('should include ask panel styles when AI is enabled', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('.ask-panel');
        expect(html).toContain('.ask-panel.hidden');
        expect(html).toContain('.ask-messages');
        expect(html).toContain('.ask-textarea');
        expect(html).toContain('.ask-panel-send');
    });

    it('should include message styling', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('.ask-message-user');
        expect(html).toContain('.ask-message-assistant');
    });

    it('should include error styling', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('.ask-message-error');
    });

    it('should include context link styling', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('.ask-message-context');
    });

    it('should include typing indicator styles', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('.ask-message-typing');
        expect(html).toContain('@keyframes typing');
    });

    it('should not include ask styles when AI is disabled', () => {
        const html = generateSpaHtml(createOptions({ enableAI: false }));
        expect(html).not.toContain('.ask-panel');
        expect(html).not.toContain('.ask-messages');
        expect(html).not.toContain('.ask-bar');
    });
});

// ============================================================================
// JavaScript Functionality
// ============================================================================

describe('Ask AI — JavaScript functionality', () => {
    it('should include askPanelSend function', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('function askPanelSend');
    });

    it('should include conversation history variable', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('var conversationHistory = []');
    });

    it('should include ask streaming flag', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('var askStreaming = false');
    });

    it('should include openAskPanel function', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('function openAskPanel');
    });

    it('should include closeAskPanel function', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('function closeAskPanel');
    });

    it('should include close panel event listener', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-close').addEventListener('click'");
    });

    it('should include clear conversation event listener', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-clear').addEventListener('click'");
    });

    it('should include send button event listener', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-panel-send').addEventListener('click', askPanelSend)");
    });

    it('should include Enter key handler on textarea', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("e.key === 'Enter'");
        expect(html).toContain('!e.shiftKey');
    });

    it('should include auto-resize for textarea', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('this.scrollHeight');
    });

    it('should fetch /api/ask with POST', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("fetch('/api/ask'");
        expect(html).toContain("method: 'POST'");
    });

    it('should send conversation history in request', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('conversationHistory');
        expect(html).toContain('JSON.stringify');
    });

    it('should process SSE events', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("data.type === 'context'");
        expect(html).toContain("data.type === 'chunk'");
        expect(html).toContain("data.type === 'done'");
        expect(html).toContain("data.type === 'error'");
    });

    it('should include helper functions for message rendering', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('function appendAskMessage');
        expect(html).toContain('function appendAskAssistantStreaming');
        expect(html).toContain('function updateAskAssistantStreaming');
        expect(html).toContain('function appendAskContext');
        expect(html).toContain('function appendAskTyping');
        expect(html).toContain('function appendAskError');
    });

    it('should include finishStreaming function', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('function finishStreaming');
    });

    it('should include updateAskSubject function', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('function updateAskSubject');
    });

    it('should disable send button during streaming', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-panel-send').disabled = true");
    });

    it('should re-enable send button after streaming', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-panel-send').disabled = false");
    });

    it('should add assistant response to conversation history', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("conversationHistory.push({ role: 'assistant'");
    });

    it('should add user message to conversation history', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("conversationHistory.push({ role: 'user'");
    });

    it('should clear conversation on clear button click', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("conversationHistory = []");
        expect(html).toContain("document.getElementById('ask-messages').innerHTML = ''");
    });

    it('should render markdown in assistant responses', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('marked.parse');
    });

    it('should show typing indicator while waiting', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('appendAskTyping()');
    });

    it('should remove typing indicator when chunks arrive', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('typingEl.parentNode.removeChild(typingEl)');
    });

    it('should not include ask JS when AI is disabled', () => {
        const html = generateSpaHtml(createOptions({ enableAI: false }));
        expect(html).not.toContain('function askPanelSend');
        expect(html).not.toContain('var conversationHistory');
    });

    it('should open panel on bar input focus', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-input').addEventListener('focus'");
        expect(html).toContain('openAskPanel()');
    });

    it('should hide bar when panel opens', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-bar').style.display = 'none'");
    });

    it('should show bar when panel closes', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.getElementById('ask-bar').style.display = ''");
    });
});

// ============================================================================
// SSE Event Handling
// ============================================================================

describe('Ask AI — SSE event handling', () => {
    it('should use ReadableStream reader for SSE parsing', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('response.body.getReader()');
        expect(html).toContain('TextDecoder');
    });

    it('should handle context module links', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain('loadModule');
        expect(html).toContain("Context: ");
    });

    it('should handle error responses from API', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("'Error: '");
        expect(html).toContain('appendAskError');
    });
});

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

describe('Ask AI — keyboard shortcuts', () => {
    it('should include keyboard event listener', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("document.addEventListener('keydown'");
    });

    it('should include Ctrl/Cmd+B shortcut for sidebar toggle', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("e.key === 'b'");
        expect(html).toContain('e.ctrlKey || e.metaKey');
    });

    it('should include Ctrl/Cmd+I shortcut for Ask AI panel toggle', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("e.key === 'i'");
    });

    it('should include Escape shortcut to close Ask AI panel', () => {
        const html = generateSpaHtml(createOptions());
        expect(html).toContain("e.key === 'Escape'");
    });

    it('should not include keyboard shortcuts when AI is disabled', () => {
        const html = generateSpaHtml(createOptions({ enableAI: false }));
        expect(html).not.toContain('openAskPanel');
    });
});

// ============================================================================
// Layout Integration
// ============================================================================

describe('Ask AI — layout integration', () => {
    it('should position panel as slide-up overlay in main-content', () => {
        const html = generateSpaHtml(createOptions());
        const panelIdx = html.indexOf('id="ask-panel"');
        const mainIdx = html.indexOf('id="main-content"');
        expect(panelIdx).toBeGreaterThan(mainIdx);
    });

    it('should position ask bar at bottom of main-content', () => {
        const html = generateSpaHtml(createOptions());
        const barIdx = html.indexOf('id="ask-bar"');
        const contentIdx = html.indexOf('id="content-scroll"');
        expect(barIdx).toBeGreaterThan(contentIdx);
    });
});
