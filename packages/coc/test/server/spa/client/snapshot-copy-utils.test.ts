/**
 * Tests for snapshot-copy-utils.ts — DOM snapshot engine.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    snapshotConversation,
    stripInteractiveElements,
    expandCollapsedGroups,
    inlineComputedStyles,
    rewriteRelativeUrls,
    buildPrintDocument,
    openPrintPreview,
} from '../../../../src/server/spa/client/react/utils/snapshot-copy-utils';

function createConversationDOM(): HTMLDivElement {
    const container = document.createElement('div');
    container.innerHTML = `
        <div class="chat-message user" data-turn-index="0">
            <div class="group w-full max-w-[95%] rounded-lg border px-3 py-2 shadow-sm bg-[#e8f3ff]">
                <div class="flex items-center gap-2 text-[11px] text-[#848484] mb-2">
                    <span class="font-medium uppercase tracking-wide role-label text-[#005a9e]">You</span>
                    <button class="bubble-copy-btn">📋</button>
                    <button class="bubble-copy-html-btn">HTML</button>
                    <button class="bubble-raw-btn">&lt;/&gt;</button>
                </div>
                <div class="chat-message-content">Hello, how are you?</div>
            </div>
        </div>
        <div class="chat-message assistant" data-turn-index="1">
            <div class="group w-full max-w-[95%] rounded-lg border px-3 py-2 shadow-sm bg-[#f8f8f8]">
                <div class="flex items-center gap-2 text-[11px] text-[#848484] mb-2">
                    <span class="font-medium uppercase tracking-wide role-label text-[#5f6a7a]">Assistant</span>
                    <button class="bubble-retry-btn" data-testid="retry-turn-btn">↺ Retry</button>
                    <button class="bubble-json-toggle-btn" data-testid="json-toggle-btn">JSON</button>
                    <button class="bubble-copy-btn">📋</button>
                    <button class="bubble-copy-html-btn">HTML</button>
                    <span class="streaming-indicator">Live</span>
                    <span class="token-usage-badge">1234 tokens</span>
                    <span class="cost-time-badge">⏱ 12.3s</span>
                    <button class="assistant-stats-badge">↓114.8k ↑761 · 16.8s</button>
                </div>
                <div class="chat-message-content">I'm doing well, thank you!</div>
                <div class="tool-call-body collapsed">Tool call result: success</div>
                <div aria-expanded="false">
                    <div class="hidden">Hidden tool content</div>
                </div>
                <img src="/api/workspaces/ws1/files/image?path=test.png" alt="test image">
                <a href="/repos/ws1">Repo link</a>
            </div>
        </div>
        <div class="chat-message assistant" data-turn-index="2">
            <div class="group w-full max-w-[95%] rounded-lg border px-3 py-2 shadow-sm bg-[#f8f8f8]">
                <div class="flex items-center gap-2 text-[11px] text-[#848484] mb-2">
                    <span class="font-medium uppercase tracking-wide role-label">Assistant</span>
                    <button class="section-copy-btn">Copy</button>
                    <button class="command-copy-btn">Copy</button>
                    <button class="mobile-preview-btn">Preview</button>
                </div>
                <div class="chat-message-content">Third turn content</div>
            </div>
        </div>
        <button data-testid="scroll-to-bottom-btn">↓</button>
        <button data-testid="load-images-btn">Load images</button>
        <button data-testid="retry-images-btn">Retry images</button>
    `;
    return container;
}

describe('stripInteractiveElements', () => {
    it('removes buttons by class name', () => {
        const container = createConversationDOM();
        stripInteractiveElements(container);

        expect(container.querySelector('.bubble-copy-btn')).toBeNull();
        expect(container.querySelector('.bubble-copy-html-btn')).toBeNull();
        expect(container.querySelector('.bubble-raw-btn')).toBeNull();
        expect(container.querySelector('.bubble-retry-btn')).toBeNull();
        expect(container.querySelector('.bubble-json-toggle-btn')).toBeNull();
        expect(container.querySelector('.command-copy-btn')).toBeNull();
        expect(container.querySelector('.mobile-preview-btn')).toBeNull();
        expect(container.querySelector('.streaming-indicator')).toBeNull();
        expect(container.querySelector('.section-copy-btn')).toBeNull();
    });

    it('removes elements by data-testid', () => {
        const container = createConversationDOM();
        stripInteractiveElements(container);

        expect(container.querySelector('[data-testid="retry-turn-btn"]')).toBeNull();
        expect(container.querySelector('[data-testid="json-toggle-btn"]')).toBeNull();
        expect(container.querySelector('[data-testid="scroll-to-bottom-btn"]')).toBeNull();
        expect(container.querySelector('[data-testid="load-images-btn"]')).toBeNull();
        expect(container.querySelector('[data-testid="retry-images-btn"]')).toBeNull();
    });

    it('removes stats badge elements (legacy and merged)', () => {
        const container = createConversationDOM();
        stripInteractiveElements(container);

        expect(container.querySelector('.token-usage-badge')).toBeNull();
        expect(container.querySelector('.cost-time-badge')).toBeNull();
        expect(container.querySelector('.assistant-stats-badge')).toBeNull();
    });

    it('preserves non-interactive content', () => {
        const container = createConversationDOM();
        stripInteractiveElements(container);

        expect(container.textContent).toContain('Hello, how are you?');
        expect(container.textContent).toContain('I\'m doing well, thank you!');
        expect(container.textContent).toContain('Third turn content');
        expect(container.querySelector('.role-label')).not.toBeNull();
    });
});

describe('expandCollapsedGroups', () => {
    it('removes collapsed class from tool-call-body', () => {
        const container = createConversationDOM();
        const collapsedEl = container.querySelector('.tool-call-body.collapsed');
        expect(collapsedEl).not.toBeNull();

        expandCollapsedGroups(container);

        const el = container.querySelector('.tool-call-body');
        expect(el).not.toBeNull();
        expect(el!.classList.contains('collapsed')).toBe(false);
    });

    it('expands aria-expanded="false" elements', () => {
        const container = createConversationDOM();
        const el = container.querySelector('[aria-expanded="false"]');
        expect(el).not.toBeNull();

        expandCollapsedGroups(container);

        expect(el!.getAttribute('aria-expanded')).toBe('true');
    });

    it('reveals hidden children of expanded groups', () => {
        const container = createConversationDOM();
        expandCollapsedGroups(container);

        const hiddenChildren = container.querySelectorAll('.hidden');
        expect(hiddenChildren.length).toBe(0);
    });
});

describe('rewriteRelativeUrls', () => {
    it('makes relative image URLs absolute', () => {
        const container = createConversationDOM();
        rewriteRelativeUrls(container, 'http://localhost:4000');

        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('http://localhost:4000/api/workspaces/ws1/files/image?path=test.png');
    });

    it('makes relative link URLs absolute', () => {
        const container = createConversationDOM();
        rewriteRelativeUrls(container, 'http://localhost:4000');

        const link = container.querySelector('a[href]');
        expect(link?.getAttribute('href')).toBe('http://localhost:4000/repos/ws1');
    });

    it('does not modify external URLs', () => {
        const container = document.createElement('div');
        container.innerHTML = `
            <img src="https://example.com/image.png" alt="test">
            <a href="https://example.com">Link</a>
        `;
        rewriteRelativeUrls(container, 'http://localhost:4000');

        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('https://example.com/image.png');
        const link = container.querySelector('a');
        expect(link?.getAttribute('href')).toBe('https://example.com');
    });

    it('does not modify protocol-relative URLs', () => {
        const container = document.createElement('div');
        container.innerHTML = '<img src="//cdn.example.com/image.png" alt="test">';
        rewriteRelativeUrls(container, 'http://localhost:4000');

        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('//cdn.example.com/image.png');
    });

    it('is a no-op when baseUrl is empty', () => {
        const container = createConversationDOM();
        const imgSrcBefore = container.querySelector('img')?.getAttribute('src');
        rewriteRelativeUrls(container, '');
        expect(container.querySelector('img')?.getAttribute('src')).toBe(imgSrcBefore);
    });
});

describe('inlineComputedStyles', () => {
    it('copies computed styles from source to clone', () => {
        const source = document.createElement('div');
        const child = document.createElement('span');
        child.textContent = 'Hello';
        source.appendChild(child);
        document.body.appendChild(source);

        const clone = source.cloneNode(true) as HTMLElement;

        inlineComputedStyles(clone, source);

        const cloneSpan = clone.querySelector('span');
        const style = cloneSpan?.getAttribute('style');
        // Should have at least some inline styles
        expect(style).toBeTruthy();

        document.body.removeChild(source);
    });

    it('skips elements that already have inline styles', () => {
        const source = document.createElement('div');
        const child = document.createElement('span');
        child.textContent = 'Hello';
        child.setAttribute('style', 'color: red;');
        source.appendChild(child);
        document.body.appendChild(source);

        const clone = source.cloneNode(true) as HTMLElement;
        inlineComputedStyles(clone, source);

        const cloneSpan = clone.querySelector('span');
        // Original inline style should be preserved (not overwritten)
        expect(cloneSpan?.getAttribute('style')).toBe('color: red;');

        document.body.removeChild(source);
    });
});

describe('snapshotConversation', () => {
    beforeEach(() => {
        // Ensure no dark mode on document
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
    });

    it('produces valid HTML string with container wrapper', () => {
        const container = createConversationDOM();
        document.body.appendChild(container);

        const html = snapshotConversation(container);

        expect(html).toContain('font-family:');
        expect(html).toContain('Hello, how are you?');
        expect(html).toContain('I\'m doing well, thank you!');

        document.body.removeChild(container);
    });

    it('strips interactive elements from the snapshot', () => {
        const container = createConversationDOM();
        document.body.appendChild(container);

        const html = snapshotConversation(container);

        expect(html).not.toContain('bubble-copy-btn');
        expect(html).not.toContain('bubble-retry-btn');
        expect(html).not.toContain('streaming-indicator');

        document.body.removeChild(container);
    });

    it('does not modify the source container', () => {
        const container = createConversationDOM();
        document.body.appendChild(container);

        const buttonsBefore = container.querySelectorAll('.bubble-copy-btn').length;
        snapshotConversation(container);
        const buttonsAfter = container.querySelectorAll('.bubble-copy-btn').length;

        expect(buttonsAfter).toBe(buttonsBefore);

        document.body.removeChild(container);
    });

    it('filters to selected turns when selectedIndices is provided', () => {
        const container = createConversationDOM();
        document.body.appendChild(container);

        const html = snapshotConversation(container, {
            selectedIndices: new Set([0]),
        });

        expect(html).toContain('Hello, how are you?');
        expect(html).not.toContain('I\'m doing well, thank you!');
        expect(html).not.toContain('Third turn content');

        document.body.removeChild(container);
    });

    it('handles forceLightMode by temporarily removing dark class', () => {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');

        const container = createConversationDOM();
        document.body.appendChild(container);

        snapshotConversation(container, { forceLightMode: true });

        // Dark class should be restored after snapshot
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

        document.body.removeChild(container);
    });

    it('restores dark mode even when an error occurs', () => {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');

        const badContainer = document.createElement('div');
        // Mock cloneNode to throw
        const originalClone = badContainer.cloneNode;
        badContainer.cloneNode = () => { throw new Error('clone failed'); };

        try {
            snapshotConversation(badContainer, { forceLightMode: true });
        } catch {
            // Expected
        }

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

        badContainer.cloneNode = originalClone;
    });

    it('expands collapsed tool groups by default', () => {
        const container = createConversationDOM();
        document.body.appendChild(container);

        const html = snapshotConversation(container);

        expect(html).toContain('Tool call result: success');
        // The collapsed class should be removed in the snapshot
        expect(html).not.toContain('class="tool-call-body collapsed"');

        document.body.removeChild(container);
    });

    it('skips tool group expansion when expandToolGroups is false', () => {
        const container = createConversationDOM();
        document.body.appendChild(container);

        const html = snapshotConversation(container, { expandToolGroups: false });

        // Content should still be there (it's in the DOM, just collapsed)
        expect(html).toContain('Tool call result: success');
        // But collapsed class should remain
        expect(html).toContain('collapsed');

        document.body.removeChild(container);
    });

    it('works with empty container', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const html = snapshotConversation(container);

        expect(html).toContain('font-family:');

        document.body.removeChild(container);
    });

    it('does not apply button styles (opacity:0) to content elements that follow stripped buttons', () => {
        // Regression test: when inlineComputedStyles was called AFTER stripInteractiveElements,
        // the parallel TreeWalker would fall out of sync — the source walker visited a removed
        // button (opacity:0) while the clone walker was already on the next content element,
        // baking opacity:0 onto the message content and making it invisible in the PDF.
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="chat-message user" data-turn-index="0">
                <div class="header">
                    <span class="role-label">You</span>
                    <button class="bubble-copy-btn" style="opacity:0">📋</button>
                    <button class="bubble-raw-btn" style="opacity:0">&lt;/&gt;</button>
                </div>
                <div class="chat-message-content">Hello world</div>
            </div>
        `;
        document.body.appendChild(container);

        const html = snapshotConversation(container);

        // The .chat-message-content must not carry opacity:0 from the removed buttons
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const content = temp.querySelector('.chat-message-content');
        const style = content?.getAttribute('style') || '';
        expect(style).not.toMatch(/opacity\s*:\s*0/);

        document.body.removeChild(container);
    });
});

describe('buildPrintDocument', () => {
    it('wraps snapshot HTML in a full HTML document', () => {
        const html = buildPrintDocument('<div>Hello</div>', 'Test Chat');
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<title>Test Chat</title>');
        expect(html).toContain('<div>Hello</div>');
        expect(html).toContain('</body>');
        expect(html).toContain('</html>');
    });

    it('includes print-optimized CSS that removes height constraints', () => {
        const html = buildPrintDocument('<div>content</div>');
        expect(html).toContain('max-height: none !important');
        expect(html).toContain('height: auto !important');
        // overflow must NOT be globally overridden (breaks flex layouts)
        expect(html).not.toContain('overflow: visible !important');
    });

    it('includes CSS for wrapping code blocks', () => {
        const html = buildPrintDocument('<pre><code>long code</code></pre>');
        expect(html).toContain('white-space: pre-wrap !important');
        expect(html).toContain('word-break: break-word !important');
    });

    it('includes CSS for image scaling', () => {
        const html = buildPrintDocument('<img src="test.png">');
        expect(html).toContain('max-width: 100% !important');
        expect(html).toContain('height: auto !important');
    });

    it('includes break-inside: avoid for turn bubbles', () => {
        const html = buildPrintDocument('<div data-turn-index="0">turn</div>');
        expect(html).toContain('break-inside: avoid');
    });

    it('uses default title when none provided', () => {
        const html = buildPrintDocument('<div>content</div>');
        expect(html).toContain('<title>Chat Conversation</title>');
    });

    it('escapes HTML special characters in the title', () => {
        const html = buildPrintDocument('<div>content</div>', '<script>alert("xss")</script>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });
});

describe('openPrintPreview', () => {
    it('opens a new window with the print document and calls print', () => {
        const mockPrint = vi.fn();
        const mockDoc = {
            write: vi.fn(),
            close: vi.fn(),
        };
        const mockWin = {
            document: mockDoc,
            print: mockPrint,
            onload: null as (() => void) | null,
        };
        vi.spyOn(window, 'open').mockReturnValue(mockWin as any);

        const result = openPrintPreview('<div>Hello</div>', 'My Chat');
        expect(result).toBe(true);
        expect(window.open).toHaveBeenCalledWith('', '_blank');
        expect(mockDoc.write).toHaveBeenCalledOnce();
        expect(mockDoc.write.mock.calls[0][0]).toContain('<!DOCTYPE html>');
        expect(mockDoc.write.mock.calls[0][0]).toContain('<title>My Chat</title>');
        expect(mockDoc.write.mock.calls[0][0]).toContain('<div>Hello</div>');
        expect(mockDoc.close).toHaveBeenCalledOnce();

        // Simulate load event
        expect(mockWin.onload).toBeTypeOf('function');
        mockWin.onload!();
        expect(mockPrint).toHaveBeenCalledOnce();

        vi.restoreAllMocks();
    });

    it('throws when popup is blocked', () => {
        vi.spyOn(window, 'open').mockReturnValue(null);

        expect(() => openPrintPreview('<div>Hello</div>')).toThrow(
            'Pop-up blocked. Please allow pop-ups for this site and try again.'
        );

        vi.restoreAllMocks();
    });
});
