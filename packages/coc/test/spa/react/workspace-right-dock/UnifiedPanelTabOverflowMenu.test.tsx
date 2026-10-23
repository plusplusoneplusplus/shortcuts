/** @vitest-environment jsdom */
import { createRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UnifiedPanelTabOverflowMenu } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabOverflowMenu';
import { UnifiedPanelCanvasStack } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelCanvasStack';
import {
    EMPTY_UNIFIED_PANEL, openTab, visibleTabs,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function sampleTabs() {
    let state = EMPTY_UNIFIED_PANEL;
    for (const [resourceId, label, repoLabel] of [
        ['a', 'Alpha', 'Project one'], ['b', 'Beta', 'Project two'], ['c', 'Gamma', 'Project three'],
    ]) {
        state = openTab(state, { kind: 'file', ownerWorkspaceId: 'workspace', chatId: 'chat', resourceId, label, repoLabel });
    }
    return visibleTabs(state, 'chat');
}

function renderMenu(overrides: Partial<ComponentProps<typeof UnifiedPanelTabOverflowMenu>> = {}) {
    const tabs = sampleTabs();
    const props = {
        title: 'Files', tabs, activeId: tabs[0].id,
        dirtyIds: new Set([tabs[1].id]), errorIds: new Set([tabs[2].id]),
        onActivate: vi.fn(), onClose: vi.fn(), onCloseMany: vi.fn(),
        trigger: <button type="button" data-strip-stop>+2</button>,
        ...overrides,
    };
    const result = render(<UnifiedPanelTabOverflowMenu {...props} />);
    return { ...result, props };
}

afterEach(cleanup);

describe('UnifiedPanelTabOverflowMenu', () => {
    it('renders the full group as an accessible listbox with active, dirty and error marks', async () => {
        const { props } = renderMenu();
        const trigger = screen.getByRole('button', { name: '+2' });
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.hasAttribute('data-strip-stop')).toBe(true);
        fireEvent.click(trigger);
        const list = screen.getByRole('listbox', { name: 'Files' });
        expect(within(list).getAllByRole('option')).toHaveLength(3);
        expect(screen.getByRole('option', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('option', { name: /Beta/ }).textContent).toContain('●');
        expect(screen.getByRole('option', { name: /Beta/ }).textContent).toContain('(unsaved changes)');
        expect(screen.getByRole('option', { name: /Gamma/ }).textContent).toContain('⚠');
        expect(screen.getByRole('option', { name: /Gamma/ }).textContent).toContain('(unavailable)');
        expect(screen.getByTestId('unified-panel-tab-overflow-menu').hasAttribute('data-native-view-overlay')).toBe(true);
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')));
        fireEvent.click(screen.getByRole('option', { name: /Beta/ }));
        expect(props.onActivate).toHaveBeenCalledWith(props.tabs[1].id);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('searches the full saved list by label and repository without changing bulk close targets', () => {
        const { props } = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: '+2' }));
        const search = screen.getByRole('textbox', { name: 'Search files' });
        fireEvent.change(search, { target: { value: ' PROJECT THREE ' } });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option').textContent).toContain('Gamma');
        fireEvent.change(search, { target: { value: 'beta' } });
        expect(screen.getByRole('option').textContent).toContain('Beta');
        fireEvent.click(screen.getByRole('button', { name: 'Close others in group' }));
        expect(props.onCloseMany).toHaveBeenCalledWith(props.tabs.slice(1).map(tab => tab.id));
    });

    it('shows both dirty and error marks even on the active group row', () => {
        const tabs = sampleTabs();
        renderMenu({ tabs, activeId: tabs[0].id, dirtyIds: new Set([tabs[0].id]), errorIds: new Set([tabs[0].id]) });
        fireEvent.click(screen.getByRole('button', { name: '+2' }));
        const option = screen.getByRole('option', { name: /Alpha/ });
        expect(option.getAttribute('aria-selected')).toBe('true');
        expect(within(option).getByTestId(`unified-panel-tab-overflow-dirty-${tabs[0].id}`)).toBeTruthy();
        expect(within(option).getByTestId(`unified-panel-tab-overflow-error-${tabs[0].id}`)).toBeTruthy();
    });

    it('wraps keyboard navigation, activates with Enter and returns focus', async () => {
        const { props } = renderMenu();
        const trigger = screen.getByRole('button', { name: '+2' });
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const search = screen.getByRole('textbox');
        fireEvent.keyDown(search, { key: 'ArrowUp' });
        expect(document.getElementById(search.getAttribute('aria-activedescendant')!)?.textContent).toContain('Gamma');
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(props.onActivate).toHaveBeenCalledWith(props.tabs[1].id);
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it('dismisses on Escape with focus return, dismisses outside, and resets search on reopen', async () => {
        renderMenu();
        const trigger = screen.getByRole('button', { name: '+2' });
        fireEvent.click(trigger);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });
        expect(screen.getByText('No matching tabs')).toBeTruthy();
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        expect(screen.queryByRole('listbox')).not.toBeNull();
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(trigger));
        fireEvent.click(trigger);
        expect(screen.getAllByRole('option')).toHaveLength(3);
        fireEvent.mouseDown(screen.getByRole('textbox'));
        expect(screen.queryByRole('listbox')).not.toBeNull();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes a row without activating it, and closes all when the active tab is outside the group', async () => {
        const { props } = renderMenu({ activeId: 'outside-group' });
        const trigger = screen.getByRole('button', { name: '+2' });
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Close Beta' }));
        expect(props.onClose).toHaveBeenCalledWith(props.tabs[1].id);
        expect(props.onActivate).not.toHaveBeenCalled();
        expect(screen.queryByRole('listbox')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Close all in group' }));
        expect(props.onCloseMany).toHaveBeenCalledWith(props.tabs.map(tab => tab.id));
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it('composes the custom trigger handlers and ref and honors prevented default actions', () => {
        const ref = createRef<HTMLButtonElement>();
        const onClick = vi.fn();
        const onKeyDown = vi.fn();
        const { rerender, props } = renderMenu({ trigger: <button ref={ref} onClick={onClick} onKeyDown={onKeyDown}>+2</button> });
        const trigger = screen.getByRole('button', { name: '+2' });
        expect(ref.current).toBe(trigger);
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(onKeyDown).toHaveBeenCalledOnce();
        expect(screen.queryByRole('listbox')).not.toBeNull();
        fireEvent.click(trigger);
        expect(onClick).toHaveBeenCalledOnce();
        expect(screen.queryByRole('listbox')).toBeNull();
        const prevent = vi.fn(event => event.preventDefault());
        rerender(<UnifiedPanelTabOverflowMenu {...props} trigger={<button ref={ref} onClick={prevent} onKeyDown={prevent}>+2</button>} />);
        fireEvent.click(trigger);
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(prevent).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('disables bulk close when there are no other tabs', () => {
        const tabs = sampleTabs().slice(0, 1);
        renderMenu({ tabs, activeId: tabs[0].id });
        fireEvent.click(screen.getByRole('button', { name: '+2' }));
        expect((screen.getByRole('button', { name: 'Close others in group' }) as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('CanvasStack compatibility wrapper', () => {
    it('preserves the canvas trigger, dialog, labels, testids and configured empty and close wording', () => {
        const tabs = sampleTabs();
        const props = {
            tabs, activeId: tabs[0].id, dirtyIds: new Set<string>(), errorIds: new Set<string>(),
            onActivate: vi.fn(), onClose: vi.fn(), onCloseMany: vi.fn(),
        };
        const { rerender } = render(<UnifiedPanelCanvasStack {...props} className="custom-chip" />);
        const trigger = screen.getByRole('button', { name: 'Show 3 canvas tabs' });
        expect(trigger.getAttribute('data-testid')).toBe('unified-panel-canvas-stack');
        expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
        expect(trigger.getAttribute('title')).toBe('3 canvas tabs');
        expect(trigger.className).toContain('custom-chip');
        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Canvas tabs' })).toBeTruthy();
        expect(screen.queryByRole('listbox')).toBeNull();
        const search = screen.getByRole('textbox', { name: 'Search canvas tabs' });
        expect(search.getAttribute('placeholder')).toBe('Search open canvases…');
        expect(screen.getByTestId(`unified-panel-canvas-stack-row-${tabs[0].id}`)).toBeTruthy();
        expect(screen.getByTestId(`unified-panel-canvas-stack-close-${tabs[0].id}`)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close other canvases' })).toBeTruthy();
        fireEvent.change(search, { target: { value: 'missing' } });
        expect(screen.getByText('No matching canvases')).toBeTruthy();
        rerender(<UnifiedPanelCanvasStack {...props} activeId={null} />);
        expect(screen.getByRole('button', { name: 'Close all canvases' })).toBeTruthy();
    });
});
