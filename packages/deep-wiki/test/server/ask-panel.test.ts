/**
 * Tests for the Ask AI panel UI in the SPA template.
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
// Ask Panel UI Tests
// ============================================================================

describe('Ask Panel UI', () => {
    describe('when AI is enabled', () => {
        it('should include the Ask AI button in the header', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-toggle"');
            expect(html).toContain('Ask AI');
        });

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

        it('should include the input textarea', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-input"');
            expect(html).toContain('placeholder="Ask about this codebase..."');
        });

        it('should include the send button', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-send"');
            expect(html).toContain('class="ask-send-btn"');
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

        it('should not include the Ask AI button', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-toggle"');
        });

        it('should not include the ask panel', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-panel"');
        });

        it('should not include ask messages area', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-messages"');
        });

        it('should not include ask input', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="ask-input"');
        });
    });

    describe('CSS styles', () => {
        it('should include ask panel styles when AI is enabled', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-panel');
            expect(html).toContain('.ask-panel.hidden');
            expect(html).toContain('.ask-messages');
            expect(html).toContain('.ask-input');
            expect(html).toContain('.ask-send-btn');
        });

        it('should include ask-toggle-btn styles', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-toggle-btn');
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

        it('should not include ask panel styles when AI is disabled', () => {
            const html = generateSpaHtml(createOptions({ enableAI: false }));
            expect(html).not.toContain('.ask-panel');
            expect(html).not.toContain('.ask-messages');
            expect(html).not.toContain('.ask-input');
        });
    });

    describe('JavaScript functionality', () => {
        it('should include askSend function', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('function askSend()');
        });

        it('should include conversation history variable', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('var conversationHistory = []');
        });

        it('should include ask streaming flag', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('var askStreaming = false');
        });

        it('should include panel toggle event listener', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.getElementById('ask-toggle').addEventListener('click'");
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
            expect(html).toContain("document.getElementById('ask-send').addEventListener('click', askSend)");
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

        it('should disable send button during streaming', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.getElementById('ask-send').disabled = true");
        });

        it('should re-enable send button after streaming', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.getElementById('ask-send').disabled = false");
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
            expect(html).not.toContain('function askSend');
            expect(html).not.toContain('var conversationHistory');
        });
    });

    describe('SSE event handling', () => {
        it('should use ReadableStream reader for SSE parsing', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('response.body.getReader()');
            expect(html).toContain('TextDecoder');
        });

        it('should handle context module links', () => {
            const html = generateSpaHtml(createOptions());
            // The appendAskContext function creates clickable links
            expect(html).toContain('loadModule');
            expect(html).toContain("Context: ");
        });

        it('should handle error responses from API', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("'Error: '");
            expect(html).toContain('appendAskError');
        });
    });

    describe('layout integration', () => {
        it('should position panel to the right of content', () => {
            const html = generateSpaHtml(createOptions());
            // Panel is inside main-area, after content
            const panelIdx = html.indexOf('id="ask-panel"');
            const contentIdx = html.indexOf('id="content-area"');
            expect(panelIdx).toBeGreaterThan(contentIdx);
        });

        it('should have a resize handle for visual separation', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-resize-handle"');
            expect(html).toContain('.ask-resize-handle');
        });

        it('should have fixed width panel', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('width: 380px');
        });
    });

    // ========================================================================
    // Ask Panel Expand/Collapse
    // ========================================================================

    describe('expand/collapse', () => {
        it('should include the expand button in panel header', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-expand"');
        });

        it('should include the expand button with correct label', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('title="Expand panel"');
            expect(html).toContain('>Expand</button>');
        });

        it('should include ask-panel-expand CSS class', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-panel-expand');
        });

        it('should include expanded CSS state', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-panel.expanded');
        });

        it('should include expand button event listener', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.getElementById('ask-expand').addEventListener('click'");
        });

        it('should include updateAskExpandBtn function', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('function updateAskExpandBtn');
        });

        it('should persist expanded state to localStorage', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("localStorage.setItem('deep-wiki-ask-expanded'");
            expect(html).toContain("localStorage.getItem('deep-wiki-ask-expanded')");
        });

        it('should restore expanded state when panel is opened', () => {
            const html = generateSpaHtml(createOptions());
            // When the toggle button is clicked, it checks localStorage for saved state
            expect(html).toContain("var savedExpanded = localStorage.getItem('deep-wiki-ask-expanded')");
        });

        it('should toggle between Expand and Collapse text', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("btn.textContent = isExpanded ? 'Collapse' : 'Expand'");
        });

        it('should include askExpanded state variable', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('var askExpanded = false');
        });

        it('should add expanded class to panel when expanding', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("panel.classList.add('expanded')");
        });

        it('should remove expanded class when collapsing', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("panel.classList.remove('expanded')");
        });

        it('should shrink content area when panel is expanded', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.content.ask-expanded');
            expect(html).toContain("content.classList.add('ask-expanded')");
        });

        it('should restore content area when panel is collapsed', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("content.classList.remove('ask-expanded')");
        });

        it('should remove ask-expanded from content when panel is closed', () => {
            const html = generateSpaHtml(createOptions());
            // Both close button and toggle-off should clean up
            expect(html).toContain("document.getElementById('content-area').classList.remove('ask-expanded')");
        });

        it('should include setAskExpanded helper function', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('function setAskExpanded');
        });

        it('should not include expand button when AI is disabled', () => {
            const html = generateSpaHtml(createOptions({ enableAI: false }));
            expect(html).not.toContain('id="ask-expand"');
            expect(html).not.toContain('.ask-panel-expand');
            expect(html).not.toContain('function updateAskExpandBtn');
        });

        it('should place expand button before clear and close buttons', () => {
            const html = generateSpaHtml(createOptions());
            const expandIdx = html.indexOf('id="ask-expand"');
            const clearIdx = html.indexOf('id="ask-clear"');
            const closeIdx = html.indexOf('id="ask-close"');
            expect(expandIdx).toBeLessThan(clearIdx);
            expect(expandIdx).toBeLessThan(closeIdx);
        });

        it('should hide resize handle when expanded', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("handle.classList.add('hidden')");
        });

        it('should show resize handle when collapsing back', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("handle.classList.remove('hidden')");
        });

        it('should clear custom width when expanding', () => {
            const html = generateSpaHtml(createOptions());
            // Expanding should reset inline width so flex takes over
            expect(html).toContain("panel.style.width = ''");
            expect(html).toContain("panel.style.minWidth = ''");
        });
    });

    // ========================================================================
    // Resize Handle (drag to resize)
    // ========================================================================

    describe('resize handle', () => {
        it('should include the resize handle element', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('id="ask-resize-handle"');
            expect(html).toContain('class="ask-resize-handle hidden"');
        });

        it('should place the resize handle between content and panel', () => {
            const html = generateSpaHtml(createOptions());
            const contentIdx = html.indexOf('id="content-area"');
            const handleIdx = html.indexOf('id="ask-resize-handle"');
            const panelIdx = html.indexOf('id="ask-panel"');
            expect(handleIdx).toBeGreaterThan(contentIdx);
            expect(handleIdx).toBeLessThan(panelIdx);
        });

        it('should include resize handle CSS', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-resize-handle');
            expect(html).toContain('cursor: col-resize');
        });

        it('should include hover/dragging styles for the handle', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-resize-handle:hover');
            expect(html).toContain('.ask-resize-handle.dragging');
        });

        it('should include a grip indicator on the handle', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-resize-handle::after');
        });

        it('should include mousedown event on resize handle', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.getElementById('ask-resize-handle').addEventListener('mousedown'");
        });

        it('should include mousemove handler for dragging', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.addEventListener('mousemove'");
            expect(html).toContain('resizeDragging');
        });

        it('should include mouseup handler to finish dragging', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.addEventListener('mouseup'");
        });

        it('should persist resized width to localStorage', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("localStorage.setItem('deep-wiki-ask-width'");
            expect(html).toContain("localStorage.getItem('deep-wiki-ask-width')");
        });

        it('should restore saved panel width on load', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('restoreAskPanelWidth');
        });

        it('should enforce minimum panel width of 280px', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('Math.max(280');
        });

        it('should disable transition during drag', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('.ask-panel.resizing');
            expect(html).toContain("panel.classList.add('resizing')");
            expect(html).toContain("panel.classList.remove('resizing')");
        });

        it('should set col-resize cursor on body during drag', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.body.style.cursor = 'col-resize'");
        });

        it('should disable text selection during drag', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.body.style.userSelect = 'none'");
        });

        it('should skip dragging in expanded mode', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('if (askExpanded) return');
        });

        it('should show/hide resize handle with panel toggle', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("handle.classList.toggle('hidden')");
        });

        it('should hide resize handle when panel is closed', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("document.getElementById('ask-resize-handle').classList.add('hidden')");
        });

        it('should not include resize handle when AI is disabled', () => {
            const html = generateSpaHtml(createOptions({ enableAI: false }));
            expect(html).not.toContain('id="ask-resize-handle"');
            expect(html).not.toContain('.ask-resize-handle');
        });

        it('should start hidden', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain('class="ask-resize-handle hidden"');
        });
    });

    // ========================================================================
    // Keyboard Shortcuts
    // ========================================================================

    describe('keyboard shortcuts', () => {
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
            // Ctrl+I shortcut for Ask AI should not be present
            expect(html).not.toContain("ask-toggle");
        });
    });

    // ========================================================================
    // Auto-collapse sidebar on expand
    // ========================================================================

    describe('auto-collapse sidebar on expand', () => {
        it('should auto-collapse sidebar when expanding ask panel', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("sidebar.classList.add('collapsed')");
            expect(html).toContain('updateSidebarCollapseBtn(true)');
        });

        it('should restore sidebar when collapsing ask panel', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("sidebar.classList.remove('collapsed')");
            expect(html).toContain('updateSidebarCollapseBtn(false)');
        });

        it('should check localStorage for saved sidebar state when collapsing', () => {
            const html = generateSpaHtml(createOptions());
            expect(html).toContain("var sidebarSaved = localStorage.getItem('deep-wiki-sidebar-collapsed')");
        });
    });
});
