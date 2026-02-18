/**
 * Tests for tool-renderer.ts — subtree collapse behavior.
 *
 * Verifies that parent task cards can collapse/expand their entire
 * nested subtool invocation tree.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import {
    renderToolCallHTML,
    renderToolCallsHTML,
    attachToolCallToggleHandlers,
    normalizeToolCall,
    renderToolCall,
    updateToolCallStatus,
    hasSubtoolChildren,
    setSubtreeCollapsed,
} from '../../../../src/server/spa/client/tool-renderer';

/* ── Helpers ──────────────────────────────────────────────── */

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'tc-1',
        toolName: overrides.toolName || 'view',
        args: overrides.args || {},
        status: overrides.status || 'completed',
        startTime: overrides.startTime || '2024-01-01T00:00:00Z',
        endTime: overrides.endTime || '2024-01-01T00:00:01Z',
        parentToolCallId: overrides.parentToolCallId,
        ...overrides,
    };
}

function htmlToElement(html: string): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.firstElementChild as HTMLElement;
}

function renderAndMount(toolCalls: any[]): HTMLElement {
    const html = renderToolCallsHTML(toolCalls);
    const container = document.createElement('div');
    container.innerHTML = html;
    attachToolCallToggleHandlers(container);
    return container;
}

/* ── Static HTML rendering tests ──────────────────────────── */

describe('renderToolCallsHTML — nested tool calls', () => {
    it('wraps child tool calls in .tool-call-children container', () => {
        const calls = [
            makeToolCall({ id: 'parent', toolName: 'task', parentToolCallId: undefined }),
            makeToolCall({ id: 'child1', toolName: 'view', parentToolCallId: 'parent' }),
            makeToolCall({ id: 'child2', toolName: 'grep', parentToolCallId: 'parent' }),
        ];
        const html = renderToolCallsHTML(calls);
        expect(html).toContain('tool-call-children');
        // Parent card should contain children
        const container = htmlToElement('<div>' + html + '</div>');
        const parentCard = container.querySelector('[data-tool-id="parent"]');
        expect(parentCard).toBeTruthy();
        const childrenDiv = parentCard!.querySelector('.tool-call-children');
        expect(childrenDiv).toBeTruthy();
        expect(childrenDiv!.querySelectorAll('.tool-call-card')).toHaveLength(2);
    });

    it('children container starts with subtree-collapsed class', () => {
        const calls = [
            makeToolCall({ id: 'parent', toolName: 'task' }),
            makeToolCall({ id: 'child', toolName: 'view', parentToolCallId: 'parent' }),
        ];
        const html = renderToolCallsHTML(calls);
        const container = htmlToElement('<div>' + html + '</div>');
        const childrenDiv = container.querySelector('.tool-call-children');
        expect(childrenDiv).toBeTruthy();
        expect(childrenDiv!.classList.contains('subtree-collapsed')).toBe(true);
    });

    it('renders deeply nested subtrees correctly', () => {
        const calls = [
            makeToolCall({ id: 'root', toolName: 'task' }),
            makeToolCall({ id: 'mid', toolName: 'task', parentToolCallId: 'root' }),
            makeToolCall({ id: 'leaf', toolName: 'view', parentToolCallId: 'mid' }),
        ];
        const html = renderToolCallsHTML(calls);
        const container = htmlToElement('<div>' + html + '</div>');
        const rootCard = container.querySelector('[data-tool-id="root"]')!;
        const midCard = rootCard.querySelector('[data-tool-id="mid"]')!;
        const leafCard = midCard.querySelector('[data-tool-id="leaf"]')!;
        expect(rootCard).toBeTruthy();
        expect(midCard).toBeTruthy();
        expect(leafCard).toBeTruthy();
    });
});

/* ── hasSubtoolChildren ───────────────────────────────────── */

describe('hasSubtoolChildren', () => {
    it('returns false for a card without children', () => {
        const card = htmlToElement(renderToolCallHTML(makeToolCall()));
        expect(hasSubtoolChildren(card)).toBe(false);
    });

    it('returns true for a card with children', () => {
        const calls = [
            makeToolCall({ id: 'parent', toolName: 'task' }),
            makeToolCall({ id: 'child', toolName: 'view', parentToolCallId: 'parent' }),
        ];
        const html = renderToolCallsHTML(calls);
        const container = htmlToElement('<div>' + html + '</div>');
        const parentCard = container.querySelector('[data-tool-id="parent"]') as HTMLElement;
        expect(hasSubtoolChildren(parentCard)).toBe(true);
    });
});

/* ── setSubtreeCollapsed ──────────────────────────────────── */

describe('setSubtreeCollapsed', () => {
    function makeNestedCards(): HTMLElement {
        const calls = [
            makeToolCall({ id: 'root', toolName: 'task' }),
            makeToolCall({ id: 'mid', toolName: 'task', parentToolCallId: 'root' }),
            makeToolCall({ id: 'leaf', toolName: 'view', parentToolCallId: 'mid' }),
        ];
        const html = renderToolCallsHTML(calls);
        return htmlToElement('<div>' + html + '</div>').querySelector('[data-tool-id="root"]') as HTMLElement;
    }

    it('adds subtree-collapsed class to children container', () => {
        const root = makeNestedCards();
        const childContainer = root.querySelector(':scope > .tool-call-children')!;
        childContainer.classList.remove('subtree-collapsed');
        setSubtreeCollapsed(root, true);
        expect(childContainer.classList.contains('subtree-collapsed')).toBe(true);
    });

    it('removes subtree-collapsed class from children container', () => {
        const root = makeNestedCards();
        setSubtreeCollapsed(root, false);
        const childContainer = root.querySelector(':scope > .tool-call-children')!;
        expect(childContainer.classList.contains('subtree-collapsed')).toBe(false);
    });

    it('recursively collapses all descendant levels', () => {
        const root = makeNestedCards();
        // First expand all
        setSubtreeCollapsed(root, false);
        // Then collapse all
        setSubtreeCollapsed(root, true);
        const allChildContainers = root.querySelectorAll('.tool-call-children');
        for (let i = 0; i < allChildContainers.length; i++) {
            expect(allChildContainers[i].classList.contains('subtree-collapsed')).toBe(true);
        }
    });

    it('recursively expands all descendant levels', () => {
        const root = makeNestedCards();
        setSubtreeCollapsed(root, false);
        const allChildContainers = root.querySelectorAll('.tool-call-children');
        for (let i = 0; i < allChildContainers.length; i++) {
            expect(allChildContainers[i].classList.contains('subtree-collapsed')).toBe(false);
        }
    });

    it('is a no-op on cards without children', () => {
        const card = htmlToElement(renderToolCallHTML(makeToolCall()));
        // Should not throw
        setSubtreeCollapsed(card, true);
        setSubtreeCollapsed(card, false);
        expect(card.querySelector('.tool-call-children')).toBeNull();
    });
});

/* ── Toggle behavior with subtree ─────────────────────────── */

describe('attachToggleBehavior — subtree collapse', () => {
    function setupNestedContainer(): HTMLElement {
        const calls = [
            makeToolCall({ id: 'parent', toolName: 'task' }),
            makeToolCall({ id: 'child1', toolName: 'view', parentToolCallId: 'parent' }),
            makeToolCall({ id: 'child2', toolName: 'bash', parentToolCallId: 'parent' }),
        ];
        return renderAndMount(calls);
    }

    it('collapsing parent hides child tool cards', () => {
        const container = setupNestedContainer();
        const parentCard = container.querySelector('[data-tool-id="parent"]') as HTMLElement;
        const childContainer = parentCard.querySelector('.tool-call-children') as HTMLElement;

        // Children start collapsed (subtree-collapsed)
        expect(childContainer.classList.contains('subtree-collapsed')).toBe(true);

        // Expand parent
        const header = parentCard.querySelector('.tool-call-header') as HTMLElement;
        header.click();
        expect(childContainer.classList.contains('subtree-collapsed')).toBe(false);

        // Collapse parent again
        header.click();
        expect(childContainer.classList.contains('subtree-collapsed')).toBe(true);
    });

    it('expanding parent shows child tool cards', () => {
        const container = setupNestedContainer();
        const parentCard = container.querySelector('[data-tool-id="parent"]') as HTMLElement;
        const childContainer = parentCard.querySelector('.tool-call-children') as HTMLElement;
        const header = parentCard.querySelector('.tool-call-header') as HTMLElement;

        // Expand
        header.click();
        expect(childContainer.classList.contains('subtree-collapsed')).toBe(false);
        // Child cards should be visible
        const childCards = childContainer.querySelectorAll('.tool-call-card');
        expect(childCards).toHaveLength(2);
    });

    it('collapsing parent recursively collapses deeply nested children', () => {
        const calls = [
            makeToolCall({ id: 'root', toolName: 'task' }),
            makeToolCall({ id: 'mid', toolName: 'task', parentToolCallId: 'root' }),
            makeToolCall({ id: 'leaf', toolName: 'view', parentToolCallId: 'mid' }),
        ];
        const container = renderAndMount(calls);
        const rootCard = container.querySelector('[data-tool-id="root"]') as HTMLElement;
        const rootHeader = rootCard.querySelector('.tool-call-header') as HTMLElement;

        // Expand root
        rootHeader.click();
        // Expand mid
        const midCard = rootCard.querySelector('[data-tool-id="mid"]') as HTMLElement;
        const midHeader = midCard.querySelector('.tool-call-header') as HTMLElement;
        midHeader.click();

        // All children should be visible
        const allChildren = rootCard.querySelectorAll('.tool-call-children');
        for (let i = 0; i < allChildren.length; i++) {
            expect(allChildren[i].classList.contains('subtree-collapsed')).toBe(false);
        }

        // Collapse root — all descendants should collapse
        rootHeader.click();
        for (let i = 0; i < allChildren.length; i++) {
            expect(allChildren[i].classList.contains('subtree-collapsed')).toBe(true);
        }
    });

    it('non-parent cards still toggle normally without errors', () => {
        const html = renderToolCallHTML(makeToolCall({ id: 'solo' }));
        const container = document.createElement('div');
        container.innerHTML = html;
        attachToolCallToggleHandlers(container);
        const card = container.querySelector('.tool-call-card') as HTMLElement;
        const body = card.querySelector('.tool-call-body') as HTMLElement;
        const header = card.querySelector('.tool-call-header') as HTMLElement;

        // Starts collapsed
        expect(body.classList.contains('collapsed')).toBe(true);

        // Expand
        header.click();
        expect(body.classList.contains('collapsed')).toBe(false);

        // Collapse
        header.click();
        expect(body.classList.contains('collapsed')).toBe(true);
    });

    it('status updates work while subtree is collapsed', () => {
        const calls = [
            makeToolCall({ id: 'parent', toolName: 'task', status: 'running' }),
            makeToolCall({ id: 'child', toolName: 'view', parentToolCallId: 'parent', status: 'running' }),
        ];
        const container = renderAndMount(calls);
        const childCard = container.querySelector('[data-tool-id="child"]') as HTMLElement;

        // Parent is collapsed, update child status
        updateToolCallStatus(childCard, {
            id: 'child',
            toolName: 'view',
            args: {},
            status: 'completed',
            endTime: '2024-01-01T00:00:05Z',
        });

        expect(childCard.getAttribute('data-status')).toBe('completed');
        const statusEl = childCard.querySelector('.tool-call-status');
        expect(statusEl?.textContent).toContain('completed');
    });
});
