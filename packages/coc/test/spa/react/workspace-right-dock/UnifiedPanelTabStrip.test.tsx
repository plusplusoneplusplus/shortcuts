/**
 * UnifiedPanelTabStrip — the Cursor-style resource strip at the top of the
 * unified right panel.
 *
 * These cases cover what the strip decides on its own: where the
 * workspace/chat divider falls, that reorder is reachable from the keyboard and
 * confined to one section, that every tab state has a non-color signal, and
 * that the "+" stays outside the scrolling row.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { UnifiedPanelTabStrip } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip';
import { POINTER_CONTEXT_DRAG_MIME } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { CANVAS_TAB_COMPRESSION_THRESHOLD, UnifiedPanelCanvasStack } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelCanvasStack';
import {
    ALL_UNIFIED_TAB_KINDS,
    openTab,
    scopeForKind,
    visibleTabs,
    EMPTY_UNIFIED_PANEL,
    type UnifiedPanelTab,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const WS = 'ws-1';
const CHAT = 'chat-1';

/** Build the visible strip for a workspace terminal plus two chat files. */
function sampleTabs(): readonly UnifiedPanelTab[] {
    let state = EMPTY_UNIFIED_PANEL;
    state = openTab(state, { kind: 'terminal', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 's1', label: 'bash' });
    state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts' });
    state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/b.ts', label: 'b.ts' });
    return visibleTabs(state, CHAT);
}

function tabsOfEveryKind(): readonly UnifiedPanelTab[] {
    let state = EMPTY_UNIFIED_PANEL;
    for (const kind of ALL_UNIFIED_TAB_KINDS) {
        state = openTab(state, {
            kind,
            ownerWorkspaceId: WS,
            chatId: scopeForKind(kind) === 'workspace' ? null : CHAT,
            resourceId: `${kind}-resource`,
            label: kind,
        });
    }
    return visibleTabs(state, CHAT);
}

function manyCanvasTabs(count = CANVAS_TAB_COMPRESSION_THRESHOLD): readonly UnifiedPanelTab[] {
    let state = EMPTY_UNIFIED_PANEL;
    state = openTab(state, { kind: 'terminal', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 's1', label: 'bash' });
    state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts' });
    for (let index = 1; index <= count; index++) {
        state = openTab(state, {
            kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT,
            resourceId: `canvas-${index}`, label: `Canvas ${index}`,
        });
    }
    return visibleTabs(state, CHAT);
}

function renderStrip(overrides: Partial<React.ComponentProps<typeof UnifiedPanelTabStrip>> = {}) {
    const props = {
        tabs: sampleTabs(),
        activeId: null,
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onCloseMany: vi.fn(),
        onMove: vi.fn(),
        onMenuAction: vi.fn(),
        ...overrides,
    };
    render(<UnifiedPanelTabStrip {...props} />);
    return props;
}

/** Render the switcher chip the way the canvas header hosts it. */
function renderStack(tabs: readonly UnifiedPanelTab[], activeId: string) {
    const props = {
        tabs: tabs.filter(tab => tab.kind === 'canvas'),
        activeId,
        dirtyIds: new Set<string>(),
        errorIds: new Set<string>(),
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onCloseMany: vi.fn(),
    };
    render(<UnifiedPanelCanvasStack {...props} />);
    return props;
}

function tabNode(tab: UnifiedPanelTab): HTMLElement {
    return screen.getByTestId(`unified-panel-tab-${tab.id}`);
}

describe('UnifiedPanelTabStrip', () => {
    afterEach(cleanup);

    it('renders nothing but the chrome when no tabs are open', () => {
        renderStrip({ tabs: [], onOpenMenu: vi.fn() });
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
        // The "+" survives an empty strip; it is the way back to a resource.
        expect(screen.getByTestId('unified-panel-open-menu')).toBeTruthy();
    });

    it('separates workspace tools from chat resources with a dedicated tab-strip divider', () => {
        const tabs = sampleTabs();
        renderStrip({ tabs });
        expect(screen.getAllByRole('tab').map(el => el.getAttribute('data-kind')))
            .toEqual(['terminal', 'file', 'file']);
        // The boundary is derived from the kinds, not passed in: exactly one tab
        // opens the chat section and the divider remains outside both tabs.
        const starts = screen.getAllByRole('tab').filter(el => el.getAttribute('data-section-start') === 'true');
        expect(starts).toHaveLength(1);
        expect(starts[0].getAttribute('data-tab-id')).toBe(tabs[1].id);
        const divider = screen.getByTestId('unified-panel-tab-section-divider');
        expect(divider.getAttribute('aria-hidden')).toBe('true');
        expect(divider.nextElementSibling).toBe(starts[0]);
    });

    it('puts chat canvases on the tools side of the divider, before files', () => {
        let state = EMPTY_UNIFIED_PANEL;
        state = openTab(state, { kind: 'terminal', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 's1', label: 'bash' });
        state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts' });
        state = openTab(state, { kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'c1', label: 'Plan' });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({ tabs });
        expect(screen.getAllByRole('tab').map(el => el.getAttribute('data-kind')))
            .toEqual(['terminal', 'canvas', 'file']);
        const divider = screen.getByTestId('unified-panel-tab-section-divider');
        expect(divider.previousElementSibling?.getAttribute('data-kind')).toBe('canvas');
        expect(divider.nextElementSibling?.getAttribute('data-kind')).toBe('file');
        // The canvas keeps its chat ownership even on the tools side.
        expect(screen.getAllByRole('tab')[1].getAttribute('data-scope')).toBe('chat');
    });

    it('draws no divider while only tools (including canvases) are open', () => {
        let state = EMPTY_UNIFIED_PANEL;
        state = openTab(state, { kind: 'terminal', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 's1', label: 'bash' });
        state = openTab(state, { kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'c1', label: 'Plan' });
        renderStrip({ tabs: visibleTabs(state, CHAT) });
        expect(screen.queryByTestId('unified-panel-tab-section-divider')).toBeNull();
    });

    describe('canvas tab compression', () => {
        it('keeps small canvas sets as ordinary tabs', () => {
            const tabs = manyCanvasTabs(CANVAS_TAB_COMPRESSION_THRESHOLD - 1);
            renderStrip({ tabs, activeId: tabs.find(tab => tab.kind === 'canvas')!.id });

            expect(screen.queryByTestId('unified-panel-canvas-stack')).toBeNull();
            expect(screen.getAllByRole('tab')).toHaveLength(tabs.length);
        });

        it('keeps the active canvas readable and leaves the count chip to the canvas header', () => {
            const tabs = manyCanvasTabs();
            const canvases = tabs.filter(tab => tab.kind === 'canvas');
            const active = canvases[2];
            renderStrip({ tabs, activeId: active.id });

            // The active canvas's own header carries the switcher (UnifiedRightPanel wires it).
            expect(screen.queryByTestId('unified-panel-canvas-stack')).toBeNull();
            expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('data-tab-id')))
                .toEqual([tabs[0].id, active.id, tabs[tabs.length - 1].id]);
            expect(tabNode(active).className).toContain('min-w-[160px]');
        });

        it('shows only the stack when a non-canvas tab is active', () => {
            const tabs = manyCanvasTabs();
            const file = tabs.find(tab => tab.kind === 'file')!;
            renderStrip({ tabs, activeId: file.id });

            expect(screen.getByTestId('unified-panel-canvas-stack').textContent).toContain('Canvases 4');
            expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('data-kind')))
                .toEqual(['terminal', 'file']);
        });

        it('searches and activates a collapsed canvas with the keyboard', () => {
            const tabs = manyCanvasTabs(6);
            const canvases = tabs.filter(tab => tab.kind === 'canvas');
            const props = renderStack(tabs, canvases[0].id);

            fireEvent.click(screen.getByTestId('unified-panel-canvas-stack'));
            const search = screen.getByTestId('unified-panel-canvas-stack-search');
            fireEvent.change(search, { target: { value: 'Canvas 5' } });
            expect(screen.getByTestId('unified-panel-canvas-stack-results').textContent).toContain('Canvas 5');
            expect(screen.getByTestId('unified-panel-canvas-stack-results').textContent).not.toContain('Canvas 1');
            fireEvent.keyDown(search, { key: 'Enter' });

            expect(props.onActivate).toHaveBeenCalledWith(canvases[4].id);
            expect(screen.queryByTestId('unified-panel-canvas-stack-menu')).toBeNull();
        });

        it('closes one canvas or bulk closes every canvas except the active one', () => {
            const tabs = manyCanvasTabs(5);
            const canvases = tabs.filter(tab => tab.kind === 'canvas');
            const props = renderStack(tabs, canvases[1].id);

            fireEvent.click(screen.getByTestId('unified-panel-canvas-stack'));
            fireEvent.click(screen.getByTestId(`unified-panel-canvas-stack-close-${canvases[3].id}`));
            expect(props.onClose).toHaveBeenCalledWith(canvases[3].id);

            fireEvent.click(screen.getByTestId('unified-panel-canvas-stack-close-others'));
            expect(props.onCloseMany).toHaveBeenCalledWith(canvases.filter(tab => tab.id !== canvases[1].id).map(tab => tab.id));
        });

        it('moves keyboard focus across rendered tabs without targeting collapsed canvases', () => {
            const tabs = manyCanvasTabs();
            const canvases = tabs.filter(tab => tab.kind === 'canvas');
            const file = tabs.find(tab => tab.kind === 'file')!;
            const props = renderStrip({ tabs, activeId: canvases[0].id });

            fireEvent.keyDown(tabNode(canvases[0]), { key: 'ArrowRight' });
            expect(props.onActivate).toHaveBeenCalledWith(file.id);
        });
    });

    it('stops Alt+Arrow at the divider between canvases and files', () => {
        let state = EMPTY_UNIFIED_PANEL;
        state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts' });
        state = openTab(state, { kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'c1', label: 'Plan' });
        const tabs = visibleTabs(state, CHAT);
        const props = renderStrip({ tabs });
        // tabs = [canvas, file]: neither may step across into the other group.
        fireEvent.keyDown(tabNode(tabs[0]), { key: 'ArrowRight', altKey: true });
        fireEvent.keyDown(tabNode(tabs[1]), { key: 'ArrowLeft', altKey: true });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    it('draws canvas tabs with the palette icon', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, { kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'c1', label: 'Plan' });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({ tabs });
        expect(tabNode(tabs[0]).querySelector('svg[data-icon="canvas-palette"]')).toBeTruthy();
    });

    it('marks the active tab for assistive tech, not only with color', () => {
        const tabs = sampleTabs();
        renderStrip({ tabs, activeId: tabs[1].id });
        expect(tabNode(tabs[1]).getAttribute('aria-selected')).toBe('true');
        expect(tabNode(tabs[0]).getAttribute('aria-selected')).toBe('false');
        // Roving tabindex: only the active tab is in the tab order.
        expect(tabNode(tabs[1]).getAttribute('tabindex')).toBe('0');
        expect(tabNode(tabs[0]).getAttribute('tabindex')).toBe('-1');
    });

    it.each([
        ['chat.md', 'M↓'],
        ['canvas-types.ts', 'TS'],
        ['native.cpp', 'C++'],
        ['lib.rs', 'RS'],
        ['AUTHORS', 'file'],
    ])('uses the Explorer file-type icon for a %s tab', (label, iconLabel) => {
        let state = EMPTY_UNIFIED_PANEL;
        state = openTab(state, {
            kind: 'file',
            ownerWorkspaceId: WS,
            chatId: CHAT,
            resourceId: `src/${label}`,
            label,
        });
        const [tab] = visibleTabs(state, CHAT);

        renderStrip({ tabs: [tab], activeId: tab.id });
        expect(screen.getByTestId(`unified-panel-tab-file-icon-${tab.id}`))
            .toHaveAttribute('data-icon-label', iconLabel);
    });

    it('activates on click and closes on the close button without activating', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[0].id });

        fireEvent.click(tabNode(tabs[2]));
        expect(props.onActivate).toHaveBeenCalledWith(tabs[2].id);

        (props.onActivate as ReturnType<typeof vi.fn>).mockClear();
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${tabs[2].id}`));
        expect(props.onClose).toHaveBeenCalledWith(tabs[2].id);
        expect(props.onActivate).not.toHaveBeenCalled();
    });

    it('closes the tab under the pointer on middle click without activating it', () => {
        const tabs = tabsOfEveryKind();
        const props = renderStrip({ tabs, activeId: tabs[0].id });

        // `fireEvent` has no auxClick helper; dispatch the DOM event React listens for.
        for (const tab of tabs) {
            fireEvent(tabNode(tab), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
            expect(props.onClose).toHaveBeenLastCalledWith(tab.id);
        }
        expect(props.onActivate).not.toHaveBeenCalled();
    });

    it('leaves non-middle auxiliary clicks available for navigation', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[0].id });

        for (const button of [3, 4]) {
            const event = new MouseEvent('auxclick', {
                bubbles: true,
                cancelable: true,
                button,
            });
            expect(tabNode(tabs[1]).dispatchEvent(event)).toBe(true);
        }
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onActivate).not.toHaveBeenCalled();
    });

    describe('context menu', () => {
        it('shows common commands for every kind and file commands only for files', () => {
            const tabs = tabsOfEveryKind();
            const props = renderStrip({
                tabs,
                activeId: tabs[0].id,
                fileActionAvailability: tab => ({
                    copyPath: tab.kind === 'file',
                    copyRelativePath: tab.kind === 'file',
                    revealInExplorer: tab.kind === 'file',
                }),
            });

            fireEvent.contextMenu(tabNode(tabs[0]), { clientX: 20, clientY: 30 });
            expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
                'Close', 'Close Other▶',
            ]);
            fireEvent.click(screen.getByRole('menuitem', { name: 'Close Other' }));
            expect(within(screen.getByRole('menu', { name: 'Close Other' })).getAllByRole('menuitem')
                .map(item => item.textContent)).toEqual([
                'Close Others', 'Close to the Right', 'Close Saved', 'Close All',
            ]);
            fireEvent.mouseDown(document.body);

            const file = tabs.find(tab => tab.kind === 'file')!;
            fireEvent.contextMenu(tabNode(file), { clientX: 20, clientY: 30 });
            expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
                'Close', 'Close Other▶', 'Copy path', 'Copy Relative Path', 'Reveal in Explorer',
            ]);
            expect(props.onActivate).not.toHaveBeenCalled();
        });

        it('offers Markdown Copy path through the keyboard menu with file grouping', async () => {
            const tabs = sampleTabs();
            const note = { ...tabs[1], kind: 'note' as const, resourceId: 'auto||/owner/file.md' };
            const props = renderStrip({
                tabs: [tabs[0], note], activeId: tabs[0].id,
                fileActionAvailability: () => ({ copyPath: true, copyRelativePath: false, revealInExplorer: false }),
            });
            const origin = tabNode(note);
            origin.focus();
            fireEvent.keyDown(origin, { key: 'F10', shiftKey: true });
            const menu = screen.getByRole('menu', { name: 'Tab actions' });
            fireEvent.keyDown(menu, { key: 'End' });
            expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy path' }));
            expect(screen.getAllByRole('separator').length).toBeGreaterThan(0);
            fireEvent.keyDown(menu, { key: 'Enter' });
            expect(props.onMenuAction).toHaveBeenCalledWith('copy-path', note.id);
            expect(props.onActivate).not.toHaveBeenCalled();
            await Promise.resolve();
            expect(document.activeElement).toBe(origin);
        });

        it('offers Keep Open for a preview and dispatches it in place', () => {
            const tabs = sampleTabs().map((tab, index) => index === 1 ? { ...tab, preview: true as const } : tab);
            const props = renderStrip({ tabs, activeId: tabs[1].id });

            fireEvent.contextMenu(tabNode(tabs[1]), { clientX: 20, clientY: 30 });
            fireEvent.click(screen.getByTestId('unified-panel-tab-menu-keep-open'));

            expect(props.onMenuAction).toHaveBeenCalledWith('keep-open', tabs[1].id);
            expect(props.onActivate).not.toHaveBeenCalled();
        });

        it('opens from the keyboard, skips disabled items, and activates with Enter', () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, activeId: tabs[0].id });
            const origin = tabNode(tabs[0]);
            origin.focus();

            fireEvent.keyDown(origin, { key: 'F10', shiftKey: true });
            expect(screen.getByTestId('unified-panel-tab-menu')).toBeTruthy();
            expect(document.activeElement).toBe(screen.getByTestId('unified-panel-tab-menu-close'));

            fireEvent.keyDown(screen.getByTestId('unified-panel-tab-menu'), { key: 'ArrowDown' });
            expect(document.activeElement).toBe(screen.getByTestId('unified-panel-tab-menu-close-other'));
            fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
            expect(document.activeElement).toBe(screen.getByTestId('unified-panel-tab-menu-close-others'));
            fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
            expect(props.onMenuAction).toHaveBeenCalledWith('close-others', tabs[0].id);
        });

        describe('Close Other submenu', () => {
            const submenu = () => screen.queryByRole('menu', { name: 'Close Other' });
            const closeOther = () => screen.getByRole('menuitem', { name: 'Close Other' });

            it('keeps Move and Close at the top level and nests all six bulk closes in order', () => {
                const tabs = sampleTabs();
                renderStrip({ tabs, activeId: tabs[0].id, groupsEnabled: true });
                fireEvent.contextMenu(tabNode(tabs[tabs.length - 1]), { clientX: 20, clientY: 30 });

                const menu = screen.getByRole('menu', { name: 'Tab actions' });
                expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
                    'Move left', 'Move right', 'Close', 'Close Other▶', 'Copy Relative Path', 'Reveal in Explorer',
                ]);
                expect(closeOther().getAttribute('aria-haspopup')).toBe('menu');
                expect(closeOther().getAttribute('aria-expanded')).toBe('false');
                expect(screen.getByTestId('unified-panel-tab-menu-close-other-chevron')).toBeTruthy();
                expect(screen.queryByTestId('unified-panel-tab-menu-close-others')).toBeNull();

                fireEvent.click(closeOther());
                expect(closeOther().getAttribute('aria-expanded')).toBe('true');
                const children = within(submenu()!).getAllByRole('menuitem');
                expect(children.map(item => item.textContent)).toEqual([
                    'Close Others', 'Close to the Right', 'Close Saved', 'Close All',
                    'Close all in group', 'Close others in group',
                ]);
                // The last tab has nothing to its right: the disabled state survives the move.
                expect(screen.getByRole('menuitem', { name: 'Close to the Right' })).toBeDisabled();
                expect(screen.getByRole('menuitem', { name: 'Close Others' })).toBeEnabled();
            });

            it('dispatches each child through the existing menu action and returns focus to the tab', async () => {
                const tabs = sampleTabs();
                const props = renderStrip({ tabs, activeId: tabs[0].id });
                const origin = tabNode(tabs[0]);
                origin.focus();
                fireEvent.contextMenu(origin, { clientX: 20, clientY: 30 });
                fireEvent.click(closeOther());
                fireEvent.click(screen.getByRole('menuitem', { name: 'Close to the Right' }));

                expect(props.onMenuAction).toHaveBeenCalledWith('close-right', tabs[0].id);
                expect(props.onClose).not.toHaveBeenCalled();
                expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
                await Promise.resolve();
                expect(document.activeElement).toBe(origin);
            });

            it('navigates with the keyboard; Escape and ArrowLeft close only the submenu', async () => {
                const tabs = sampleTabs();
                const props = renderStrip({ tabs, activeId: tabs[0].id });
                const origin = tabNode(tabs[0]);
                origin.focus();
                fireEvent.keyDown(origin, { key: 'F10', shiftKey: true });

                fireEvent.keyDown(screen.getByTestId('unified-panel-tab-menu'), { key: 'ArrowDown' });
                fireEvent.keyDown(closeOther(), { key: 'ArrowRight' });
                expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close Others' }));
                fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
                expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close to the Right' }));
                fireEvent.keyDown(document.activeElement!, { key: 'End' });
                expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close All' }));
                fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
                expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close Others' }));

                fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
                expect(submenu()).toBeNull();
                expect(screen.getByTestId('unified-panel-tab-menu')).toBeTruthy();
                expect(document.activeElement).toBe(closeOther());

                fireEvent.keyDown(closeOther(), { key: ' ' });
                expect(submenu()).not.toBeNull();
                fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
                expect(submenu()).toBeNull();
                expect(document.activeElement).toBe(closeOther());

                fireEvent.keyDown(closeOther(), { key: 'Escape' });
                await Promise.resolve();
                expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
                expect(document.activeElement).toBe(origin);
                expect(props.onMenuAction).not.toHaveBeenCalled();
            });

            it('opens on mouse hover, not touch hover, and toggles on tap', () => {
                const tabs = sampleTabs();
                renderStrip({ tabs, activeId: tabs[0].id });
                fireEvent.contextMenu(tabNode(tabs[0]), { clientX: 20, clientY: 30 });

                fireEvent.pointerEnter(closeOther(), { pointerType: 'touch' });
                expect(submenu()).toBeNull();
                fireEvent.click(closeOther());
                expect(submenu()).not.toBeNull();
                fireEvent.click(closeOther());
                expect(submenu()).toBeNull();

                fireEvent.pointerEnter(closeOther(), { pointerType: 'mouse' });
                expect(submenu()).not.toBeNull();
                // Clicking inside the submenu is not an outside click.
                fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Close Others' }));
                expect(submenu()).not.toBeNull();
                fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Close' }), { pointerType: 'mouse' });
                expect(submenu()).toBeNull();
            });

            it('flips left and stays inside the viewport near the right and bottom edges', () => {
                const originalRect = HTMLElement.prototype.getBoundingClientRect;
                const originalWidth = window.innerWidth;
                const originalHeight = window.innerHeight;
                Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
                Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
                HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
                    const box = this.getAttribute('role') === 'menu' && this.getAttribute('aria-label') === 'Close Other'
                        ? { top: 0, left: 0, width: 200, height: 150 }
                        : this.dataset.testid === 'unified-panel-tab-menu-close-other'
                            ? { top: 560, left: 600, width: 190, height: 24 }
                            : { top: 0, left: 0, width: 190, height: 100 };
                    return {
                        ...box, x: box.left, y: box.top,
                        right: box.left + box.width, bottom: box.top + box.height,
                        toJSON: () => ({}),
                    } as DOMRect;
                };
                try {
                    const tabs = sampleTabs();
                    renderStrip({ tabs, activeId: tabs[0].id });
                    fireEvent.contextMenu(tabNode(tabs[0]), { clientX: 790, clientY: 590 });
                    fireEvent.click(closeOther());
                    const panel = submenu()!;
                    // No room right of 790: open on the row's left side.
                    expect(panel.style.left).toBe('400px');
                    // 560 + 150 overflows 600; it grows upward from the row bottom (584).
                    expect(parseFloat(panel.style.top)).toBe(434);
                    expect(parseFloat(panel.style.top) + 150).toBeLessThanOrEqual(600 - 4);
                } finally {
                    HTMLElement.prototype.getBoundingClientRect = originalRect;
                    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
                    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
                }
            });
        });

        it('keeps the menu inside the viewport', () => {
            const originalRect = HTMLElement.prototype.getBoundingClientRect;
            const originalWidth = window.innerWidth;
            const originalHeight = window.innerHeight;
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
            Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
            HTMLElement.prototype.getBoundingClientRect = () => ({
                x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 300, width: 200, height: 300,
                toJSON: () => ({}),
            });
            try {
                const tabs = sampleTabs();
                renderStrip({ tabs, activeId: tabs[0].id });
                fireEvent.contextMenu(tabNode(tabs[0]), { clientX: 790, clientY: 590 });
                const menu = screen.getByTestId('unified-panel-tab-menu');
                expect(menu.style.left).toBe('596px');
                expect(menu.style.top).toBe('296px');
            } finally {
                HTMLElement.prototype.getBoundingClientRect = originalRect;
                Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
                Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
            }
        });

        it('dismisses on Escape and outside click and restores focus to the origin', async () => {
            const tabs = sampleTabs();
            renderStrip({ tabs, activeId: tabs[0].id });
            const origin = tabNode(tabs[0]);
            origin.focus();

            fireEvent.contextMenu(origin, { clientX: 20, clientY: 30 });
            fireEvent.keyDown(document, { key: 'Escape' });
            await Promise.resolve();
            expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
            expect(document.activeElement).toBe(origin);

            fireEvent.contextMenu(origin, { clientX: 20, clientY: 30 });
            fireEvent.mouseDown(document.body);
            await Promise.resolve();
            expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
            expect(document.activeElement).toBe(origin);
        });

        it('dismisses when canvas compression hides the menu origin', () => {
            const initialTabs = manyCanvasTabs(CANVAS_TAB_COMPRESSION_THRESHOLD - 1);
            const origin = initialTabs.find(tab => tab.kind === 'canvas')!;
            const baseProps: React.ComponentProps<typeof UnifiedPanelTabStrip> = {
                tabs: initialTabs,
                activeId: initialTabs[0].id,
                onActivate: vi.fn(),
                onClose: vi.fn(),
                onCloseMany: vi.fn(),
                onMove: vi.fn(),
                onMenuAction: vi.fn(),
            };
            const { rerender } = render(<UnifiedPanelTabStrip {...baseProps} />);

            fireEvent.contextMenu(tabNode(origin), { clientX: 20, clientY: 30 });
            expect(screen.getByTestId('unified-panel-tab-menu')).toBeTruthy();

            const compressedTabs = manyCanvasTabs(CANVAS_TAB_COMPRESSION_THRESHOLD);
            const activeCanvas = compressedTabs.filter(tab => tab.kind === 'canvas').at(-1)!;
            rerender(
                <UnifiedPanelTabStrip
                    {...baseProps}
                    tabs={compressedTabs}
                    activeId={activeCanvas.id}
                />,
            );

            expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
        });
    });

    it('walks tabs with the arrow keys, wrapping at both ends', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[0].id });

        fireEvent.keyDown(tabNode(tabs[0]), { key: 'ArrowRight' });
        expect(props.onActivate).toHaveBeenCalledWith(tabs[1].id);

        fireEvent.keyDown(tabNode(tabs[0]), { key: 'ArrowLeft' });
        expect(props.onActivate).toHaveBeenCalledWith(tabs[2].id);

        fireEvent.keyDown(tabNode(tabs[1]), { key: 'End' });
        expect(props.onActivate).toHaveBeenCalledWith(tabs[2].id);

        fireEvent.keyDown(tabNode(tabs[1]), { key: 'Home' });
        expect(props.onActivate).toHaveBeenCalledWith(tabs[0].id);
    });

    it('activates on Enter and Space', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[0].id });
        fireEvent.keyDown(tabNode(tabs[1]), { key: 'Enter' });
        fireEvent.keyDown(tabNode(tabs[2]), { key: ' ' });
        expect(props.onActivate).toHaveBeenCalledWith(tabs[1].id);
        expect(props.onActivate).toHaveBeenCalledWith(tabs[2].id);
    });

    it('reorders from the keyboard with Alt+Arrow, within one section', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[1].id });

        // a.ts one place right → it should land after b.ts, i.e. at the end.
        fireEvent.keyDown(tabNode(tabs[1]), { key: 'ArrowRight', altKey: true });
        expect(props.onMove).toHaveBeenCalledWith(tabs[1].id, null);

        // b.ts one place left → before a.ts.
        (props.onMove as ReturnType<typeof vi.fn>).mockClear();
        fireEvent.keyDown(tabNode(tabs[2]), { key: 'ArrowLeft', altKey: true });
        expect(props.onMove).toHaveBeenCalledWith(tabs[2].id, tabs[1].id);
    });

    it('refuses a keyboard reorder that would leave the tab section', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[1].id });

        // The lone workspace tab has nowhere to go inside its own section, and
        // it must not be pushed into the chat section instead.
        fireEvent.keyDown(tabNode(tabs[0]), { key: 'ArrowRight', altKey: true });
        fireEvent.keyDown(tabNode(tabs[0]), { key: 'ArrowLeft', altKey: true });
        expect(props.onMove).not.toHaveBeenCalled();

        // Likewise the first chat tab cannot step left past the divider.
        fireEvent.keyDown(tabNode(tabs[1]), { key: 'ArrowLeft', altKey: true });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    it('does not activate a tab while Alt-reordering it', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[1].id });
        fireEvent.keyDown(tabNode(tabs[1]), { key: 'ArrowRight', altKey: true });
        expect(props.onActivate).not.toHaveBeenCalled();
    });

    it('reports a drag-and-drop reorder as move-before-the-drop-target', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[1].id });
        const data = new Map<string, string>();
        const dataTransfer = {
            setData: (type: string, value: string) => data.set(type, value),
            getData: (type: string) => data.get(type) ?? '',
            effectAllowed: '',
            dropEffect: '',
        };
        fireEvent.dragStart(tabNode(tabs[2]), { dataTransfer });
        fireEvent.drop(tabNode(tabs[1]), { dataTransfer });
        expect(props.onMove).toHaveBeenCalledWith(tabs[2].id, tabs[1].id);
    });

    it('adds file context to a tab drag while reorder still reads the tab id', () => {
        const tabs = sampleTabs();
        const context = { kind: 'coc.git-file-context', version: 1, sourceWorkspaceId: WS, sourceRoutingRef: null,
            filePath: 'docs/SKILL.md', side: 'working-tree', label: 'docs/SKILL.md' } as const;
        const contextDragPayload = vi.fn((tab: UnifiedPanelTab) => tab.id === tabs[2].id ? context : null);
        const props = renderStrip({ tabs, activeId: tabs[1].id, contextDragPayload });
        const data = new Map<string, string>();
        const dataTransfer = {
            setData: (type: string, value: string) => data.set(type, value),
            getData: (type: string) => data.get(type) ?? '',
            effectAllowed: '',
            dropEffect: '',
        };
        fireEvent.dragStart(tabNode(tabs[2]), { dataTransfer });
        expect(JSON.parse(data.get(POINTER_CONTEXT_DRAG_MIME)!)).toEqual(context);
        expect(data.get('application/x-coc-panel-tab')).toBe(tabs[2].id);
        // No text flavour: dropping a tab on an editor must not type into it.
        expect(data.has('text/plain')).toBe(false);
        expect(dataTransfer.effectAllowed).toBe('copyMove');
        fireEvent.drop(tabNode(tabs[1]), { dataTransfer });
        expect(props.onMove).toHaveBeenCalledWith(tabs[2].id, tabs[1].id);

        data.clear();
        fireEvent.dragStart(tabNode(tabs[1]), { dataTransfer });
        expect(data.has(POINTER_CONTEXT_DRAG_MIME)).toBe(false);
        expect(dataTransfer.effectAllowed).toBe('move');
    });

    it('reports the dragged tab until the drag ends or is cancelled', () => {
        const tabs = sampleTabs();
        const onTabDragChange = vi.fn();
        renderStrip({ tabs, activeId: tabs[1].id, reorderEnabled: true, onTabDragChange });
        const dataTransfer = { setData: () => undefined, effectAllowed: '', dropEffect: '' };
        fireEvent.dragStart(tabNode(tabs[2]), { dataTransfer });
        expect(onTabDragChange).toHaveBeenLastCalledWith(tabs[2].id);
        fireEvent.dragEnd(tabNode(tabs[2]));
        expect(onTabDragChange).toHaveBeenLastCalledWith(null);

        fireEvent.dragStart(tabNode(tabs[1]), { dataTransfer });
        expect(onTabDragChange).toHaveBeenLastCalledWith(tabs[1].id);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onTabDragChange).toHaveBeenLastCalledWith(null);
        expect(onTabDragChange).toHaveBeenCalledTimes(4);
    });

    describe('mixed-type reordering', () => {
        function drag(node: HTMLElement, type: string, clientX = 0) {
            fireEvent(node, new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
        }

        function rect(node: HTMLElement, left = 100) {
            vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
                left, right: left + 100, top: 0, bottom: 35, x: left, y: 0, width: 100, height: 35,
                toJSON: () => ({}),
            });
        }

        it('moves across kinds with Alt+Arrow without activating or closing and retains focus', () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, activeId: tabs[1].id, reorderEnabled: true });
            const node = tabNode(tabs[1]);
            node.focus();
            fireEvent.keyDown(node, { key: 'ArrowLeft', altKey: true });
            expect(props.onMove).toHaveBeenCalledWith(tabs[1].id, tabs[0].id);
            expect(props.onActivate).not.toHaveBeenCalled();
            expect(props.onClose).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(node);
            expect(screen.queryByTestId('unified-panel-tab-section-divider')).toBeNull();
            expect(screen.getByRole('status').textContent).toBe('Tab moved left. Position 1 of 3.');
        });

        it('offers menu moves, disables boundaries, and leaves other menu commands unchanged', async () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, activeId: tabs[0].id, reorderEnabled: true });
            fireEvent.keyDown(tabNode(tabs[0]), { key: 'F10', shiftKey: true });
            expect(screen.getByTestId('unified-panel-tab-menu-move-left')).toBeDisabled();
            fireEvent.click(screen.getByTestId('unified-panel-tab-menu-move-right'));
            expect(props.onMove).toHaveBeenCalledWith(tabs[0].id, tabs[2].id);
            await Promise.resolve();
            expect(document.activeElement).toBe(tabNode(tabs[0]));
            fireEvent.contextMenu(tabNode(tabs[2]));
            expect(screen.getByTestId('unified-panel-tab-menu-move-right')).toBeDisabled();
            fireEvent.click(screen.getByTestId('unified-panel-tab-menu-close'));
            expect(props.onMenuAction).toHaveBeenCalledWith('close', tabs[2].id);
        });

        it('uses target halves for insertion, styles the drag and suppresses trailing click/close', () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, activeId: tabs[0].id, reorderEnabled: true });
            rect(tabNode(tabs[2]));
            drag(tabNode(tabs[0]), 'dragstart');
            drag(tabNode(tabs[2]), 'dragover', 175);
            expect(tabNode(tabs[0]).getAttribute('data-dragging')).toBe('true');
            expect(screen.getByTestId('unified-panel-tab-drop-indicator').getAttribute('data-position')).toBe('after');
            drag(tabNode(tabs[2]), 'drop', 175);
            expect(props.onMove).toHaveBeenCalledWith(tabs[0].id, null);
            expect(screen.queryByTestId('unified-panel-tab-drop-indicator')).toBeNull();
            fireEvent.click(tabNode(tabs[0]));
            fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${tabs[0].id}`));
            expect(props.onActivate).not.toHaveBeenCalled();
            expect(props.onClose).not.toHaveBeenCalled();
            expect(tabNode(tabs[0]).getAttribute('aria-selected')).toBe('true');
        });

        it('clears a previous insertion marker over the source tab or a pinned tab', () => {
            const tabs = sampleTabs();
            renderStrip({ tabs, reorderEnabled: true, pinnedId: tabs[2].id });
            rect(tabNode(tabs[1]));
            drag(tabNode(tabs[0]), 'dragstart');
            drag(tabNode(tabs[1]), 'dragover', 110);
            expect(screen.getByTestId('unified-panel-tab-drop-indicator')).toBeTruthy();
            drag(tabNode(tabs[0]), 'dragover');
            expect(screen.queryByTestId('unified-panel-tab-drop-indicator')).toBeNull();
            drag(tabNode(tabs[1]), 'dragover', 110);
            drag(tabNode(tabs[2]), 'dragover');
            expect(screen.queryByTestId('unified-panel-tab-drop-indicator')).toBeNull();
        });

        it('rejects foreign transfers and cancels on Escape or dragend', () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, reorderEnabled: true });
            rect(tabNode(tabs[1]));
            drag(tabNode(tabs[1]), 'drop', 110);
            expect(props.onMove).not.toHaveBeenCalled();
            for (const cancel of ['escape', 'dragend']) {
                drag(tabNode(tabs[0]), 'dragstart');
                drag(tabNode(tabs[1]), 'dragover', 110);
                expect(screen.getByTestId('unified-panel-tab-drop-indicator')).toBeTruthy();
                if (cancel === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
                else drag(tabNode(tabs[0]), 'dragend');
                expect(screen.queryByTestId('unified-panel-tab-drop-indicator')).toBeNull();
                drag(tabNode(tabs[1]), 'drop', 110);
            }
            expect(props.onMove).not.toHaveBeenCalled();
        });

        it('rejects cross-strip drops even when both strips contain the same tab identities', () => {
            const tabs = sampleTabs();
            const props = {
                tabs, activeId: tabs[0].id, onActivate: vi.fn(), onClose: vi.fn(), onCloseMany: vi.fn(),
                onMove: vi.fn(), reorderEnabled: true,
            };
            const source = render(<UnifiedPanelTabStrip {...props} />);
            const onOtherMove = vi.fn();
            const target = render(<UnifiedPanelTabStrip {...props} onMove={onOtherMove} />);
            const transfer = { setData: vi.fn(), getData: () => tabs[0].id, effectAllowed: 'move', dropEffect: 'move' };
            fireEvent.dragStart(source.container.querySelector('[role="tab"]')!, { dataTransfer: transfer });
            fireEvent.drop(target.container.querySelectorAll('[role="tab"]')[1], { dataTransfer: transfer });
            expect(onOtherMove).not.toHaveBeenCalled();
            expect(props.onMove).not.toHaveBeenCalled();
        });

        it('cancels when the source closes, scope switches, or the feature is disabled', () => {
            const tabs = sampleTabs();
            const props = {
                tabs, activeId: tabs[0].id, onActivate: vi.fn(), onClose: vi.fn(), onCloseMany: vi.fn(),
                onMove: vi.fn(), reorderEnabled: true, reorderScope: 'owner-a',
            };
            const { rerender } = render(<UnifiedPanelTabStrip {...props} />);
            drag(tabNode(tabs[0]), 'dragstart');
            rerender(<UnifiedPanelTabStrip {...props} tabs={tabs.slice(1)} />);
            drag(tabNode(tabs[1]), 'drop');
            rerender(<UnifiedPanelTabStrip {...props} />);
            drag(tabNode(tabs[0]), 'dragstart');
            rerender(<UnifiedPanelTabStrip {...props} reorderScope="owner-b" />);
            drag(tabNode(tabs[1]), 'drop');
            drag(tabNode(tabs[0]), 'dragstart');
            rerender(<UnifiedPanelTabStrip {...props} reorderEnabled={false} />);
            drag(tabNode(tabs[1]), 'drop');
            expect(props.onMove).not.toHaveBeenCalled();
        });

        it('scrolls overflow near the edge and accepts a drop on the row tail', () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, reorderEnabled: true });
            const list = screen.getByTestId('unified-panel-tab-list');
            rect(list, 0);
            drag(tabNode(tabs[0]), 'dragstart');
            drag(list, 'dragover', 95);
            expect(list.scrollLeft).toBe(24);
            expect(screen.getByTestId('unified-panel-tab-drop-indicator').getAttribute('data-position')).toBe('after');
            drag(list, 'drop', 95);
            expect(props.onMove).toHaveBeenCalledWith(tabs[0].id, null);
        });

        it('excludes pinned excursion tabs and prevents dragging a close button', () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, reorderEnabled: true, pinnedId: tabs[0].id });
            expect(tabNode(tabs[0]).getAttribute('draggable')).toBe('false');
            drag(tabNode(tabs[0]), 'dragstart');
            drag(tabNode(tabs[1]), 'drop');
            drag(screen.getByTestId(`unified-panel-tab-close-${tabs[1].id}`), 'dragstart');
            drag(tabNode(tabs[2]), 'drop');
            fireEvent.keyDown(tabNode(tabs[0]), { key: 'ArrowRight', altKey: true });
            expect(props.onMove).not.toHaveBeenCalled();
        });

        it('keeps middle-click close working when no drag is in progress', () => {
            const tabs = sampleTabs();
            const props = renderStrip({ tabs, reorderEnabled: true });
            fireEvent(tabNode(tabs[1]), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
            expect(props.onClose).toHaveBeenCalledWith(tabs[1].id);
        });
    });

    it('ignores a drop onto the dragged tab itself', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[1].id });
        const data = new Map<string, string>();
        const dataTransfer = {
            setData: (type: string, value: string) => data.set(type, value),
            getData: (type: string) => data.get(type) ?? '',
            effectAllowed: '',
            dropEffect: '',
        };
        fireEvent.dragStart(tabNode(tabs[1]), { dataTransfer });
        fireEvent.drop(tabNode(tabs[1]), { dataTransfer });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    it('signals dirty and error states without relying on color', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts',
        });
        state = openTab(state, { kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'c1', label: 'Plan' });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({
            tabs,
            activeId: tabs[0].id,
            dirtyIds: new Set([tabs[1].id]),
            errorIds: new Set([tabs[0].id]),
        });

        expect(screen.getByTestId(`unified-panel-tab-error-${tabs[0].id}`)).toBeTruthy();
        expect(screen.getByTestId(`unified-panel-tab-dirty-${tabs[1].id}`)).toBeTruthy();
        expect(tabNode(tabs[1]).getAttribute('data-dirty')).toBe('true');
        // …and the same states are spelled out for a screen reader.
        expect(tabNode(tabs[0]).textContent).toContain('(unavailable)');
        expect(tabNode(tabs[1]).textContent).toContain('(unsaved changes)');
    });

    it('shows a source file by bare name and puts its repo-qualified path in the tooltip', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: 'member-2', chatId: CHAT, resourceId: 'src/index.ts',
            label: 'index.ts', repoLabel: 'api',
        });
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: 'member-3', chatId: CHAT, resourceId: 'src/index.ts',
            label: 'index.ts', repoLabel: 'web', preview: false,
        });
        const tabs = visibleTabs(state, CHAT);
        expect(tabs).toHaveLength(2);
        renderStrip({ tabs, activeId: tabs[0].id, dirtyIds: new Set([tabs[1].id]), errorIds: new Set([tabs[1].id]) });

        for (const [tab, repo] of [[tabs[0], 'api'], [tabs[1], 'web']] as const) {
            expect(screen.queryByTestId(`unified-panel-tab-repo-${tab.id}`)).toBeNull();
            expect(screen.getByTestId(`unified-panel-tab-label-${tab.id}`).textContent).toBe('index.ts');
            expect(tabNode(tab).getAttribute('title')).toContain(`index.ts — ${repo}: src/index.ts`);
            // The repo still disambiguates for a screen reader.
            expect(tabNode(tab).querySelector('.sr-only')?.textContent).toContain(`— ${repo}`);
        }
        expect(tabNode(tabs[1]).textContent).toContain('(unsaved changes)');
        expect(tabNode(tabs[1]).textContent).toContain('(unavailable)');
        expect(screen.getByTestId(`unified-panel-tab-dirty-${tabs[1].id}`)).toBeTruthy();
        expect(screen.getByTestId(`unified-panel-tab-error-${tabs[1].id}`)).toBeTruthy();
    });

    it('shows a file path in the tooltip even without a repo', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/lib/util.ts', label: 'util.ts',
        });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({ tabs, activeId: tabs[0].id });
        expect(tabNode(tabs[0]).getAttribute('title')).toBe('util.ts — src/lib/util.ts');
    });

    describe('file path tooltips', () => {
        function pathTabs(): readonly UnifiedPanelTab[] {
            let state = EMPTY_UNIFIED_PANEL;
            state = openTab(state, {
                kind: 'note', ownerWorkspaceId: 'member-2', chatId: null, label: 'unify-review-chat-tabs.md',
                resourceId: 'auto||docs/plans/unify-review-chat-tabs.md', repoLabel: 'api',
            });
            state = openTab(state, {
                kind: 'html-page', ownerWorkspaceId: WS, chatId: CHAT, label: 'index.html',
                resourceId: '/w/pages/index.html', htmlPageId: 'page-1',
            });
            state = openTab(state, {
                kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, label: 'util.ts', resourceId: 'src/lib/util.ts',
            });
            state = openTab(state, {
                kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, label: 'Plan', resourceId: 'cv-1', repoLabel: 'api',
            });
            return visibleTabs(state, CHAT);
        }
        const byKind = (tabs: readonly UnifiedPanelTab[], kind: UnifiedPanelTab['kind']) => tabs.find(tab => tab.kind === kind)!;
        const pathTip = () => screen.queryByTestId('unified-panel-tab-path-tooltip');

        it('puts note and HTML page paths in the hover title from their descriptors', () => {
            const tabs = pathTabs();
            renderStrip({ tabs });
            expect(tabNode(byKind(tabs, 'note')).getAttribute('title'))
                .toBe('unify-review-chat-tabs.md — api: docs/plans/unify-review-chat-tabs.md');
            expect(tabNode(byKind(tabs, 'html-page')).getAttribute('title')).toBe('index.html — /w/pages/index.html');
            expect(tabNode(byKind(tabs, 'canvas')).getAttribute('title')).toBe('Plan — api');
        });

        it('strips the workspace preview marker from a file path', () => {
            const state = openTab(EMPTY_UNIFIED_PANEL, {
                kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, label: 'report.md',
                resourceId: '__workspace_preview__:/remote/out/report.md', repoLabel: 'remote',
            });
            const tabs = visibleTabs(state, CHAT);
            renderStrip({ tabs });
            expect(tabNode(tabs[0]).getAttribute('title')).toBe('report.md — remote: /remote/out/report.md');
        });

        it.each([false, true])('shows the path on keyboard focus and hides it on blur or Escape (groups: %s)', groupsEnabled => {
            const tabs = pathTabs();
            const note = byKind(tabs, 'note');
            const file = byKind(tabs, 'file');
            const props = renderStrip({ tabs, activeId: note.id, groupsEnabled });
            fireEvent.focus(tabNode(note));
            const tip = screen.getByRole('tooltip');
            expect(tip).toHaveTextContent('api: docs/plans/unify-review-chat-tabs.md');
            // A tooltip must never blank a desktop page view below the strip.
            expect(tip).toHaveAttribute('data-native-view-passthrough');
            expect(tip).not.toHaveAttribute('data-native-view-overlay');
            expect(tabNode(note)).toHaveAttribute('aria-describedby', tip.id);
            fireEvent.keyDown(tabNode(note), { key: 'Escape' });
            expect(pathTip()).toBeNull();
            expect(tabNode(note)).not.toHaveAttribute('aria-describedby');
            fireEvent.focus(tabNode(file));
            expect(screen.getByRole('tooltip')).toHaveTextContent('src/lib/util.ts');
            fireEvent.blur(tabNode(file));
            expect(pathTip()).toBeNull();
            expect(props.onActivate).not.toHaveBeenCalled();
            expect(props.onClose).not.toHaveBeenCalled();
        });

        it('skips the focus tooltip for pointer focus, focused children and non-file tabs', () => {
            const tabs = pathTabs();
            const note = byKind(tabs, 'note');
            renderStrip({ tabs, activeId: note.id });
            fireEvent.pointerDown(tabNode(note));
            fireEvent.focus(tabNode(note));
            expect(pathTip()).toBeNull();
            fireEvent.focus(tabNode(byKind(tabs, 'canvas')));
            expect(pathTip()).toBeNull();
            const close = tabNode(note).querySelector('button');
            if (close) {
                fireEvent.focus(close);
                expect(pathTip()).toBeNull();
            }
            fireEvent.focus(tabNode(note));
            expect(screen.getByRole('tooltip')).toHaveTextContent('docs/plans/unify-review-chat-tabs.md');
            fireEvent.pointerDown(tabNode(note));
            expect(pathTip()).toBeNull();
        });

        it('keeps the tooltip inside the viewport and opens it above the tab when there is room', () => {
            const tabs = pathTabs();
            const file = byKind(tabs, 'file');
            renderStrip({ tabs, activeId: file.id });
            tabNode(file).getBoundingClientRect = () => ({ left: window.innerWidth - 20, top: 10, bottom: 40 } as DOMRect);
            fireEvent.focus(tabNode(file));
            let tip = screen.getByRole('tooltip');
            expect(parseFloat(tip.style.left)).toBeLessThanOrEqual(window.innerWidth - Math.min(360, window.innerWidth - 16) - 8);
            expect(tip.style.top).toBe('44px');
            expect(tip.style.transform).toBe('');
            fireEvent.blur(tabNode(file));
            tabNode(file).getBoundingClientRect = () => ({ left: 100, top: 120, bottom: 150 } as DOMRect);
            fireEvent.focus(tabNode(file));
            tip = screen.getByRole('tooltip');
            expect(tip.style.left).toBe('100px');
            expect(tip.style.top).toBe('116px');
            expect(tip.style.transform).toBe('translateY(-100%)');
        });

        it('leaves a desktop page view placed while its tab shows the focus tooltip', () => {
            const tabs = pathTabs();
            const page = byKind(tabs, 'html-page');
            renderStrip({ tabs, activeId: page.id });
            fireEvent.focus(tabNode(page));
            expect(screen.getByRole('tooltip')).toHaveTextContent('/w/pages/index.html');
            expect(document.querySelector('[data-native-view-overlay]')).toBeNull();
        });
    });

    it('keeps the repo badge on non-source tabs', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'canvas', ownerWorkspaceId: 'member-2', chatId: CHAT, resourceId: 'cv-1',
            label: 'Plan', repoLabel: 'api',
        });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({ tabs, activeId: tabs[0].id });
        expect(screen.getByTestId(`unified-panel-tab-repo-${tabs[0].id}`).textContent).toBe('api');
        expect(tabNode(tabs[0]).getAttribute('title')).toBe('Plan — api');
        expect(tabNode(tabs[0]).querySelector('.sr-only')?.textContent).not.toContain('api');
    });

    it.each([false, true])('hides only browser repo labels in repo groups (grouped tabs: %s)', groupsEnabled => {
        const tabs = tabsOfEveryKind().filter(tab => ['browser', 'terminal', 'canvas', 'file', 'note'].includes(tab.kind))
            .map(tab => ({ ...tab, repoLabel: 'Target repo' }));
        renderStrip({ tabs, hideBrowserRepoLabels: true, groupsEnabled });
        for (const tab of tabs) {
            const badge = screen.queryByTestId(`unified-panel-tab-repo-${tab.id}`);
            if (tab.kind === 'browser') {
                expect(badge).toBeNull();
                expect(tabNode(tab).textContent).not.toContain('Target repo');
                expect(tabNode(tab).getAttribute('title')).toBe(tab.label);
                expect(screen.getByRole('tab', { name: /^browser/ })).toBe(tabNode(tab));
                expect(tabNode(tab).querySelector('[data-icon="browser-globe"]')).toBeTruthy();
            } else if (tab.kind === 'file') {
                expect(badge).toBeNull();
                expect(tabNode(tab).querySelector('.sr-only')?.textContent).toContain('Target repo');
            } else {
                expect(badge?.textContent).toBe('Target repo');
                expect(tabNode(tab).getAttribute('title')).toContain('Target repo');
            }
        }
    });

    it('keeps browser repo labels outside repo groups', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'browser', ownerWorkspaceId: WS, resourceId: 'page', label: 'Page', repoLabel: 'Target repo',
        });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({ tabs });
        expect(screen.getByTestId(`unified-panel-tab-repo-${tabs[0].id}`).textContent).toBe('Target repo');
        expect(tabNode(tabs[0]).getAttribute('title')).toBe('Page — Target repo');
    });

    it('gives browser tabs one title-independent width that shrinks to a shared floor', () => {
        let state = EMPTY_UNIFIED_PANEL;
        for (const label of ['Google', 'Search - Microsoft Bing with a very long page title', 'YouTube', 'A']) {
            state = openTab(state, { kind: 'browser', ownerWorkspaceId: WS, chatId: CHAT, resourceId: label, label });
        }
        state = openTab(state, { kind: 'terminal', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 's1', label: 'bash' });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({ tabs, activeId: tabs[0].id });
        const browserTabs = tabs.filter(tab => tab.kind === 'browser');
        const sizing = (tab: UnifiedPanelTab) => tabNode(tab).className.split(/\s+/)
            .filter(name => /^(min-w|max-w|basis|flex-shrink)/.test(name)).sort().join(' ');
        expect(new Set(browserTabs.map(sizing))).toEqual(new Set([sizing(browserTabs[0])]));
        expect(sizing(browserTabs[0])).toBe('basis-[160px] flex-shrink max-w-[160px] min-w-[96px]');
        for (const tab of browserTabs) {
            expect(screen.getByTestId(`unified-panel-tab-label-${tab.id}`).className).toMatch(/\btruncate\b.*\bflex-1\b/);
        }
        // Other kinds keep their content-sized, non-shrinking tabs.
        expect(sizing(tabs.find(tab => tab.kind === 'terminal')!)).toBe('flex-shrink-0 max-w-[180px] min-w-0');
    });

    it('keeps the "+" outside the scrolling tab row', () => {
        const onOpenMenu = vi.fn();
        renderStrip({ onOpenMenu });
        const button = screen.getByTestId('unified-panel-open-menu');
        expect(screen.getByTestId('unified-panel-tab-list').contains(button)).toBe(false);
        fireEvent.click(button);
        expect(onOpenMenu).toHaveBeenCalled();
    });

    it('omits the "+" when the host supplies no menu', () => {
        renderStrip();
        expect(screen.queryByTestId('unified-panel-open-menu')).toBeNull();
    });

    it('scrolls the active tab back into view when it changes', () => {
        const tabs = sampleTabs();
        const scrollIntoView = vi.fn();
        // jsdom does not implement scrollIntoView; the strip calls it optionally.
        (Element.prototype as any).scrollIntoView = scrollIntoView;
        try {
            renderStrip({ tabs, activeId: tabs[2].id });
            expect(scrollIntoView).toHaveBeenCalled();
        } finally {
            delete (Element.prototype as any).scrollIntoView;
        }
    });

    it('reveals external activation even when a different reordered tab retains keyboard focus', () => {
        const tabs = sampleTabs();
        const props = {
            tabs, activeId: tabs[0].id, onActivate: vi.fn(), onClose: vi.fn(),
            onCloseMany: vi.fn(), onMove: vi.fn(), reorderEnabled: true,
        };
        const { rerender } = render(<UnifiedPanelTabStrip {...props} />);
        const scroll = vi.fn();
        tabNode(tabs[2]).scrollIntoView = scroll;
        tabNode(tabs[0]).focus();
        rerender(<UnifiedPanelTabStrip {...props} activeId={tabs[2].id} />);
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
        expect(document.activeElement).toBe(tabNode(tabs[0]));
    });

    describe('overlay scrollbar', () => {
        /** Give the tab row fake scroll metrics (jsdom has no layout) and re-measure. */
        function overflow(list: HTMLElement, clientWidth: number, scrollWidth: number, scrollLeft = 0) {
            Object.defineProperty(list, 'clientWidth', { configurable: true, value: clientWidth });
            Object.defineProperty(list, 'scrollWidth', { configurable: true, value: scrollWidth });
            list.scrollLeft = scrollLeft;
            fireEvent.scroll(list);
        }

        it('hides the native scrollbar on the tab row', () => {
            renderStrip();
            expect(screen.getByTestId('unified-panel-tab-list').className).toContain('scrollbar-hide');
        });

        it('shows no thumb when the tabs fit', () => {
            renderStrip();
            overflow(screen.getByTestId('unified-panel-tab-list'), 300, 300);
            expect(screen.queryByTestId('unified-panel-tab-scroll-thumb')).toBeNull();
        });

        it('sizes and places the thumb from the row scroll position', () => {
            renderStrip();
            const list = screen.getByTestId('unified-panel-tab-list');
            overflow(list, 200, 800);
            const thumb = screen.getByTestId('unified-panel-tab-scroll-thumb');
            expect(thumb.style.width).toBe('50px');
            expect(thumb.style.left).toBe('0px');
            overflow(list, 200, 800, 400);
            expect(thumb.style.left).toBe('100px');
            // The thumb overlays the row instead of taking layout space under it.
            expect(list.contains(thumb)).toBe(false);
            expect(thumb.className).toContain('absolute');
        });

        it('scrolls the row sideways on a vertical wheel', () => {
            renderStrip();
            const list = screen.getByTestId('unified-panel-tab-list');
            overflow(list, 200, 800);
            fireEvent.wheel(list, { deltaY: 120, deltaX: 0 });
            expect(list.scrollLeft).toBe(120);
            // A horizontal gesture is left to the browser.
            fireEvent.wheel(list, { deltaY: 0, deltaX: 40 });
            expect(list.scrollLeft).toBe(120);
        });

        it('leaves the wheel alone when nothing overflows', () => {
            renderStrip();
            const list = screen.getByTestId('unified-panel-tab-list');
            overflow(list, 300, 300);
            fireEvent.wheel(list, { deltaY: 120 });
            expect(list.scrollLeft).toBe(0);
        });

        it('drags the thumb to scroll the row proportionally', () => {
            renderStrip();
            const list = screen.getByTestId('unified-panel-tab-list');
            overflow(list, 200, 800);
            const thumb = screen.getByTestId('unified-panel-tab-scroll-thumb');
            fireEvent.pointerDown(thumb, { button: 0, clientX: 10 });
            fireEvent.pointerMove(window, { clientX: 30 });
            // 20px of thumb travel is 20 * (800 / 200) px of row scroll.
            expect(list.scrollLeft).toBe(80);
            fireEvent.pointerUp(window);
            fireEvent.pointerMove(window, { clientX: 100 });
            expect(list.scrollLeft).toBe(80);
        });
    });
});
