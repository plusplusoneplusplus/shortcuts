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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { UnifiedPanelTabStrip } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip';
import {
    openTab,
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

function renderStrip(overrides: Partial<React.ComponentProps<typeof UnifiedPanelTabStrip>> = {}) {
    const props = {
        tabs: sampleTabs(),
        activeId: null,
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onMove: vi.fn(),
        ...overrides,
    };
    render(<UnifiedPanelTabStrip {...props} />);
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

    it('orders workspace tabs first and marks where the chat section starts', () => {
        const tabs = sampleTabs();
        renderStrip({ tabs });
        expect(screen.getAllByRole('tab').map(el => el.getAttribute('data-kind')))
            .toEqual(['terminal', 'file', 'file']);
        // The divider is derived from the kinds, not passed in: exactly one tab
        // opens the chat section.
        const starts = screen.getAllByRole('tab').filter(el => el.getAttribute('data-section-start') === 'true');
        expect(starts).toHaveLength(1);
        expect(starts[0].getAttribute('data-tab-id')).toBe(tabs[1].id);
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

    it('closes on middle click', () => {
        const tabs = sampleTabs();
        const props = renderStrip({ tabs, activeId: tabs[0].id });
        // `fireEvent` has no auxClick helper; dispatch the DOM event React listens for.
        fireEvent(tabNode(tabs[1]), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
        expect(props.onClose).toHaveBeenCalledWith(tabs[1].id);
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

    it('signals read-only, dirty, and error states without relying on color', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts', readOnly: true,
        });
        state = openTab(state, { kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'c1', label: 'Plan' });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({
            tabs,
            activeId: tabs[0].id,
            dirtyIds: new Set([tabs[1].id]),
            errorIds: new Set([tabs[0].id]),
        });

        expect(screen.getByTestId(`unified-panel-tab-readonly-${tabs[0].id}`)).toBeTruthy();
        expect(screen.getByTestId(`unified-panel-tab-error-${tabs[0].id}`)).toBeTruthy();
        expect(screen.getByTestId(`unified-panel-tab-dirty-${tabs[1].id}`)).toBeTruthy();
        expect(tabNode(tabs[0]).getAttribute('data-readonly')).toBe('true');
        expect(tabNode(tabs[1]).getAttribute('data-dirty')).toBe('true');
        // …and the same states are spelled out for a screen reader.
        expect(tabNode(tabs[0]).textContent).toContain('(read-only)');
        expect(tabNode(tabs[0]).textContent).toContain('(unavailable)');
        expect(tabNode(tabs[1]).textContent).toContain('(unsaved changes)');
    });

    it('shows repo attribution and the full title on an ambiguous label', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: 'member-2', chatId: CHAT, resourceId: 'src/index.ts',
            label: 'index.ts', repoLabel: 'api',
        });
        const tabs = visibleTabs(state, CHAT);
        renderStrip({ tabs, activeId: tabs[0].id });
        expect(screen.getByTestId(`unified-panel-tab-repo-${tabs[0].id}`).textContent).toBe('api');
        expect(tabNode(tabs[0]).getAttribute('title')).toBe('index.ts — api');
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
});
