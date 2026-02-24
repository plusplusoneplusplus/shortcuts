/**
 * Tests for useCodeBlockActions hook.
 *
 * Verifies:
 * - Copy button copies data-raw content to clipboard
 * - Collapse button toggles data-collapsed attribute
 * - Collapsed-indicator click expands the block
 * - Table copy button copies data-table-markdown content
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCodeBlockActions } from '../../../src/server/spa/client/react/hooks/useCodeBlockActions';

describe('useCodeBlockActions', () => {
    let container: HTMLDivElement;

    const createRef = (el: HTMLElement) => ({ current: el });

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
        vi.restoreAllMocks();
    });

    // ── Collapse / Expand ────────────────────────────────────────────

    it('toggles data-collapsed from true to false on collapse button click', () => {
        const block = document.createElement('div');
        block.className = 'code-block-container';
        block.setAttribute('data-collapsed', 'true');
        block.setAttribute('data-collapsible', 'true');

        const btn = document.createElement('button');
        btn.className = 'code-block-collapse';
        btn.textContent = '\u25B6';
        btn.title = 'Expand code block';
        block.appendChild(btn);
        container.appendChild(block);

        renderHook(() => useCodeBlockActions(createRef(container)));

        btn.click();

        expect(block.getAttribute('data-collapsed')).toBe('false');
        expect(btn.textContent).toBe('\u25BC');
        expect(btn.title).toBe('Collapse code block');
    });

    it('toggles data-collapsed from false to true on collapse button click', () => {
        const block = document.createElement('div');
        block.className = 'code-block-container';
        block.setAttribute('data-collapsed', 'false');
        block.setAttribute('data-collapsible', 'true');

        const btn = document.createElement('button');
        btn.className = 'code-block-collapse';
        btn.textContent = '\u25BC';
        btn.title = 'Collapse code block';
        block.appendChild(btn);
        container.appendChild(block);

        renderHook(() => useCodeBlockActions(createRef(container)));

        btn.click();

        expect(block.getAttribute('data-collapsed')).toBe('true');
        expect(btn.textContent).toBe('\u25B6');
        expect(btn.title).toBe('Expand code block');
    });

    it('expands block when collapsed-indicator is clicked', () => {
        const block = document.createElement('div');
        block.className = 'code-block-container';
        block.setAttribute('data-collapsed', 'true');

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'code-block-collapse';
        collapseBtn.textContent = '\u25B6';
        collapseBtn.title = 'Expand code block';
        block.appendChild(collapseBtn);

        const indicator = document.createElement('div');
        indicator.className = 'code-block-collapsed-indicator';
        indicator.textContent = 'Show 10 more lines';
        block.appendChild(indicator);
        container.appendChild(block);

        renderHook(() => useCodeBlockActions(createRef(container)));

        indicator.click();

        expect(block.getAttribute('data-collapsed')).toBe('false');
        expect(collapseBtn.textContent).toBe('\u25BC');
        expect(collapseBtn.title).toBe('Collapse code block');
    });

    // ── Copy ─────────────────────────────────────────────────────────

    it('copies code block content to clipboard on copy button click', async () => {
        const writeTextSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextSpy },
            writable: true,
            configurable: true,
        });

        const block = document.createElement('div');
        block.className = 'code-block-container';
        block.setAttribute('data-raw', 'const x = 1;&#10;const y = 2;');

        const btn = document.createElement('button');
        btn.className = 'code-block-copy';
        btn.textContent = '\uD83D\uDCCB';
        block.appendChild(btn);
        container.appendChild(block);

        renderHook(() => useCodeBlockActions(createRef(container)));

        btn.click();

        expect(writeTextSpy).toHaveBeenCalledWith('const x = 1;\nconst y = 2;');
    });

    it('decodes HTML entities in data-raw before copying', async () => {
        const writeTextSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextSpy },
            writable: true,
            configurable: true,
        });

        const block = document.createElement('div');
        block.className = 'code-block-container';
        block.setAttribute('data-raw', '&lt;div&gt;&amp;&quot;test&quot;&lt;/div&gt;');

        const btn = document.createElement('button');
        btn.className = 'code-block-copy';
        block.appendChild(btn);
        container.appendChild(block);

        renderHook(() => useCodeBlockActions(createRef(container)));

        btn.click();

        expect(writeTextSpy).toHaveBeenCalledWith('<div>&"test"</div>');
    });

    // ── Table copy ───────────────────────────────────────────────────

    it('copies table markdown on table copy button click', async () => {
        const writeTextSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextSpy },
            writable: true,
            configurable: true,
        });

        const btn = document.createElement('button');
        btn.className = 'md-table-copy-btn';
        btn.setAttribute('data-table-markdown', '| A | B |&#10;| --- | --- |&#10;| 1 | 2 |');
        btn.textContent = '\u29C9 Copy';
        container.appendChild(btn);

        renderHook(() => useCodeBlockActions(createRef(container)));

        btn.click();

        expect(writeTextSpy).toHaveBeenCalledWith('| A | B |\n| --- | --- |\n| 1 | 2 |');
    });

    // ── No-op on unrelated clicks ────────────────────────────────────

    it('does not throw on clicks outside code blocks', () => {
        const p = document.createElement('p');
        p.textContent = 'Hello';
        container.appendChild(p);

        renderHook(() => useCodeBlockActions(createRef(container)));

        expect(() => p.click()).not.toThrow();
    });

    // ── Null container ref ───────────────────────────────────────────

    it('handles null container ref gracefully', () => {
        const ref = { current: null };
        expect(() => {
            renderHook(() => useCodeBlockActions(ref));
        }).not.toThrow();
    });

    // ── Cleanup ──────────────────────────────────────────────────────

    it('removes event listener on unmount', () => {
        const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener');

        const { unmount } = renderHook(() => useCodeBlockActions(createRef(container)));

        unmount();

        expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
    });
});
