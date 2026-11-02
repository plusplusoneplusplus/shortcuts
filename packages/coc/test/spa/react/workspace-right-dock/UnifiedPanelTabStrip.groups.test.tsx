/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
    UnifiedPanelTabStrip,
    type UnifiedPanelTabStripProps,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip';
import type { UnifiedTabStripGroup } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabGroups';
import {
    clearUnifiedTabGroupState, moveTabGroup, readUnifiedTabGroupOrder, useUnifiedTabGroupOrder,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabGroupStore';
import {
    unifiedPanelBulkCloseTargets,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabMenuModel';
import {
    ALL_UNIFIED_TAB_KINDS,
    scopeForKind,
    type UnifiedPanelTab,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function tab(kind: UnifiedPanelTab['kind'], label: string, overrides: Partial<UnifiedPanelTab> = {}): UnifiedPanelTab {
    return Object.freeze({
        id: `${kind}:${label}`, kind, label, resourceId: label,
        ownerWorkspaceId: 'workspace', chatId: scopeForKind(kind) === 'workspace' ? null : 'chat',
        ...overrides,
    });
}

function files(count = 5): readonly UnifiedPanelTab[] {
    return Object.freeze(Array.from({ length: count }, (_, index) => tab('file', `file-${index + 1}.ts`)));
}

function renderStrip(overrides: Partial<UnifiedPanelTabStripProps> = {}, stateful = false) {
    const props = {
        tabs: files(),
        activeId: null,
        groupsEnabled: true,
        foldedGroups: new Set<UnifiedTabStripGroup>(),
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onCloseMany: vi.fn(),
        onMove: vi.fn(),
        onMenuAction: vi.fn(),
        onToggleGroup: vi.fn(),
        ...overrides,
    };
    function Harness() {
        const [activeId, setActiveId] = useState(props.activeId);
        const [foldedGroups, setFoldedGroups] = useState(props.foldedGroups);
        return <>
            <UnifiedPanelTabStrip {...props}
                activeId={activeId}
                foldedGroups={foldedGroups}
                onActivate={id => {
                    props.onActivate(id);
                    setActiveId(id);
                }}
                onToggleGroup={group => {
                    props.onToggleGroup(group);
                    setFoldedGroups(current => {
                        const next = new Set(current);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                    });
                }}
            />
            <span data-testid="saved-tab-order">{JSON.stringify(props.tabs.map(entry => entry.id))}</span>
        </>;
    }
    const view = render(stateful ? <Harness /> : <UnifiedPanelTabStrip {...props} />);
    return { ...view, props };
}

function tabNode(entry: UnifiedPanelTab): HTMLElement {
    return screen.getByTestId(`unified-panel-tab-${entry.id}`);
}

function shownIds(group: UnifiedTabStripGroup): (string | null)[] {
    return within(screen.getByTestId(`unified-panel-group-${group}`).parentElement!)
        .queryAllByRole('tab').map(node => node.getAttribute('data-tab-id'));
}

function overflow(group: UnifiedTabStripGroup = 'files'): HTMLElement {
    return screen.getByTestId(`unified-panel-group-overflow-${group}`);
}

describe('UnifiedPanelTabStrip grouped presentation', () => {
    afterEach(cleanup);

    it.each([
        ['chat-turn-runner.ts', 'TS'],
        ['client.js', 'JS'],
        ['package.json', 'NPM'],
        ['unknown.extension', 'file'],
    ])('reuses the strip and collapsed-menu icon for expanded overflow file %s', (label, iconLabel) => {
        const hidden = tab('file', label, { resourceId: `src/${label}`, repoLabel: 'Remote repo' });
        const tabs = [...files(3), hidden];
        const { props, rerender } = renderStrip({ tabs, activeId: tabs[0].id });
        fireEvent.click(overflow());
        const option = screen.getByRole('option', { name: `${label}Remote repo` });
        const icon = within(option).getByTestId('file-type-icon');
        expect(icon).toHaveAttribute('data-icon-label', iconLabel);
        expect(icon.parentElement).toHaveAttribute('aria-hidden', 'true');
        expect(icon.parentElement).toHaveClass('flex-shrink-0', 'opacity-80');
        expect(icon.compareDocumentPosition(within(option).getByText(label)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(option).toHaveAttribute('title', `Remote repo: src/${label}`);
        const menuIcon = icon.outerHTML;
        const menuIconClass = icon.parentElement!.className;

        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        rerender(<UnifiedPanelTabStrip {...props} foldedGroups={new Set(['files'])} />);
        fireEvent.click(screen.getByTestId('unified-panel-group-menu-files'));
        const collapsedIcon = within(screen.getByRole('option', { name: `${label}Remote repo` })).getByTestId('file-type-icon');
        expect(collapsedIcon.outerHTML).toBe(menuIcon);
        expect(collapsedIcon.parentElement!.className).toBe(menuIconClass);

        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        rerender(<UnifiedPanelTabStrip {...props} activeId={hidden.id} />);
        const stripIcon = screen.getByTestId(`unified-panel-tab-file-icon-${hidden.id}`);
        expect(stripIcon.outerHTML.replace(`unified-panel-tab-file-icon-${hidden.id}`, 'file-type-icon')).toBe(menuIcon);
        expect(screen.getAllByTestId(`unified-panel-tab-file-icon-${hidden.id}`)).toHaveLength(1);
    });

    it.each([
        ['terminal', 'tools'], ['browser', 'web'], ['canvas', 'canvas'],
    ] as const)('shows the matching %s icon in expanded %s overflow', (kind, group) => {
        const tabs = Array.from({ length: 4 }, (_, index) => tab(kind, `Resource ${index}`));
        const { props, rerender } = renderStrip({ tabs });
        const stripIcon = tabNode(tabs[0]).querySelector('[aria-hidden="true"]')!.innerHTML;
        fireEvent.click(overflow(group));
        const option = screen.getByRole('option', { name: tabs[3].label });
        expect(option.querySelectorAll(':scope > [aria-hidden="true"]')[1].innerHTML).toBe(stripIcon);
        fireEvent.click(option);
        expect(props.onActivate).toHaveBeenCalledWith(tabs[3].id);
        rerender(<UnifiedPanelTabStrip {...props} activeId={tabs[3].id} />);
        expect(tabNode(tabs[3])).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps repo-group browser overflow labels free of repository names', () => {
        const tabs = Array.from({ length: 5 }, (_, index) => tab('browser', `Page ${index}`, {
            repoLabel: `Repo ${index}`, ownerWorkspaceId: `owner-${index}`,
        }));
        const { props } = renderStrip({ tabs, hideBrowserRepoLabels: true });
        fireEvent.click(screen.getByTestId('unified-panel-group-overflow-web'));
        for (const entry of tabs.slice(3)) {
            expect(screen.getByRole('option', { name: entry.label })).toBeTruthy();
            expect(screen.getByTestId(`unified-panel-tab-overflow-row-${entry.id}`)).not.toHaveTextContent(entry.repoLabel!);
        }
        fireEvent.click(screen.getByRole('option', { name: tabs[4].label }));
        expect(props.onActivate).toHaveBeenCalledWith(tabs[4].id);
    });

    it('uses fixed Tools, Files, Web, Canvas order and exposes counts and expanded state', () => {
        const tabs = Object.freeze([...ALL_UNIFIED_TAB_KINDS, 'external' as const].reverse()
            .map(kind => tab(kind, kind)));
        renderStrip({ tabs, activeId: tabs.find(entry => entry.kind === 'browser')!.id });

        expect(screen.getByRole('tablist', { name: 'Open resources' })).toHaveAttribute('aria-orientation', 'horizontal');
        expect(screen.getAllByRole('group').map(node => node.getAttribute('aria-label'))).toEqual([
            'Tools, 7 tabs, 4 hidden', 'Files, 5 tabs, 2 hidden',
            'Web, 2 tabs, 0 hidden', 'Canvas, 1 tabs, 0 hidden',
        ]);
        for (const [name, count] of [['Tools', 7], ['Files', 5], ['Web', 2], ['Canvas', 1]]) {
            expect(screen.getByRole('button', { name: `${name}, ${count} tabs` })).toHaveAttribute('aria-expanded', 'true');
        }
        expect(tabNode(tabs.find(entry => entry.kind === 'browser')!)).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('unified-panel-tab-section-divider')).toBeNull();
        expect(screen.queryByTestId('unified-panel-canvas-stack')).toBeNull();
    });

    it('omits empty groups and renders no labels or overflow for an empty session', () => {
        const { rerender, props } = renderStrip({ tabs: [tab('canvas', 'Diagram')] });
        expect(screen.getAllByRole('group')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Canvas, 1 tabs' })).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-group-tools')).toBeNull();
        expect(screen.queryByTestId('unified-panel-group-overflow-canvas')).toBeNull();
        rerender(<UnifiedPanelTabStrip {...props} tabs={[]} />);
        expect(screen.queryAllByRole('group')).toHaveLength(0);
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
    });

    it('caps each group at three while keeping overflow active and preview descriptors visible', () => {
        const base = files(6);
        const tabs = Object.freeze(base.map((entry, index) => index === 5 ? Object.freeze({ ...entry, preview: true }) : entry));
        renderStrip({ tabs, activeId: tabs[4].id });

        expect(shownIds('files')).toEqual([tabs[0].id, tabs[4].id, tabs[5].id]);
        expect(tabNode(tabs[5])).toHaveAttribute('data-preview', 'true');
        expect(overflow()).toHaveTextContent('+3');
        expect(overflow()).toHaveAttribute('aria-label', 'Show 3 hidden Files tabs');
        expect(tabs.map(entry => entry.id)).toEqual(base.map(entry => entry.id));
    });

    it('activates a hidden tab in the trailing slot without rewriting saved tabs or fold preferences', () => {
        const tabs = files();
        const savedOrder = JSON.stringify(tabs.map(entry => entry.id));
        const { props } = renderStrip({ tabs, activeId: tabs[0].id }, true);
        fireEvent.click(overflow());
        const list = screen.getByRole('listbox', { name: 'Files tabs' });
        const initialOptions = within(list).getAllByRole('option');
        expect(initialOptions).toHaveLength(2);
        expect(initialOptions[0]).toHaveAccessibleName('file-4.ts');
        expect(initialOptions[1]).toHaveAccessibleName('file-5.ts');
        fireEvent.click(within(list).getByRole('option', { name: /file-5.ts/ }));

        expect(props.onActivate).toHaveBeenCalledWith(tabs[4].id);
        expect(shownIds('files')).toEqual([tabs[0].id, tabs[1].id, tabs[4].id]);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(screen.getByTestId('saved-tab-order')).toHaveTextContent(savedOrder);
        expect(screen.getByRole('button', { name: 'Files, 5 tabs' })).toHaveAttribute('aria-expanded', 'true');
        expect(props.onToggleGroup).not.toHaveBeenCalled();
        expect(props.onMove).not.toHaveBeenCalled();

        // The promoted tab left the overflow; the tab it displaced joined it.
        expect(overflow()).toHaveTextContent('+2');
        fireEvent.click(overflow());
        const updatedOptions = screen.getAllByRole('option');
        expect(updatedOptions).toHaveLength(2);
        expect(updatedOptions[0]).toHaveAccessibleName('file-3.ts');
        expect(updatedOptions[1]).toHaveAccessibleName('file-4.ts');
    });

    it('lists only the tabs the strip hides, keyed by id rather than title', () => {
        // Web group from the bug report, plus a hidden tab that shares a visible tab's title and URL.
        const tabs = Object.freeze([
            tab('browser', 'Google', { id: 'browser:1', resourceId: 'https://google.com' }),
            tab('browser', 'Search - Microsoft Bing', { id: 'browser:2' }),
            tab('browser', 'YouTube', { id: 'browser:3' }),
            tab('browser', 'Apple', { id: 'browser:4' }),
            tab('browser', 'Google', { id: 'browser:5', resourceId: 'https://google.com' }),
        ]);
        const { props, rerender } = renderStrip({ tabs, activeId: tabs[1].id });
        expect(overflow('web')).toHaveTextContent('+2');
        fireEvent.click(overflow('web'));
        const menu = screen.getByTestId('unified-panel-tab-overflow-menu');
        expect(within(menu).getByText('2 hidden')).toBeTruthy();
        expect(screen.getAllByRole('option').map(node => node.closest('[data-testid]')!.getAttribute('data-testid')))
            .toEqual(['unified-panel-tab-overflow-row-browser:4', 'unified-panel-tab-overflow-row-browser:5']);

        // Search covers only overflow entries; a visible-only match shows the empty state.
        const search = screen.getByRole('textbox', { name: 'Search web tabs' });
        fireEvent.change(search, { target: { value: 'youtube' } });
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText('No matching tabs')).toBeTruthy();
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(props.onActivate).not.toHaveBeenCalled();
        fireEvent.change(search, { target: { value: 'google' } });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(props.onActivate).toHaveBeenCalledWith('browser:5');

        // Closing a hidden tab shrinks the list; the last one removes +N.
        rerender(<UnifiedPanelTabStrip {...props} tabs={tabs.slice(0, 4)} />);
        expect(overflow('web')).toHaveTextContent('+1');
        fireEvent.click(overflow('web'));
        expect(screen.getAllByRole('option').map(node => node.textContent)).toEqual(['Apple']);
        expect(within(screen.getByTestId('unified-panel-tab-overflow-menu')).getByText('1 hidden')).toBeTruthy();
        rerender(<UnifiedPanelTabStrip {...props} tabs={tabs.slice(0, 3)} />);
        expect(screen.queryByTestId('unified-panel-group-overflow-web')).toBeNull();
    });

    it('searches hidden tabs by label and owner label, then activates with Enter', () => {
        const tabs = Object.freeze(files().map((entry, index) => index === 4
            ? Object.freeze({ ...entry, repoLabel: 'Other project', ownerWorkspaceId: 'other-workspace' }) : entry));
        const { props } = renderStrip({ tabs, activeId: tabs[0].id });
        fireEvent.click(overflow());
        const search = screen.getByRole('textbox', { name: 'Search files tabs' });
        fireEvent.change(search, { target: { value: 'FILE-4' } });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent(tabs[3].label);
        fireEvent.change(search, { target: { value: 'FILE-1' } });
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        fireEvent.change(search, { target: { value: 'other PROJECT' } });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent(tabs[4].label);
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(props.onActivate).toHaveBeenCalledWith(tabs[4].id);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes one hidden row and bulk-closes all group members except the active one, independent of search', () => {
        const groupTabs = files();
        const tabs = Object.freeze([tab('terminal', 'Shell'), ...groupTabs, tab('canvas', 'Plan')]);
        const { props } = renderStrip({ tabs, activeId: groupTabs[1].id });
        fireEvent.click(overflow());
        fireEvent.click(within(screen.getByRole('listbox')).getByRole('button', { name: `Close ${groupTabs[4].label}` }));
        expect(props.onClose).toHaveBeenCalledWith(groupTabs[4].id);
        expect(props.onActivate).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: groupTabs[4].label } });
        fireEvent.click(screen.getByRole('button', { name: 'Close others in group' }));
        expect(props.onCloseMany).toHaveBeenCalledWith(groupTabs.filter(entry => entry.id !== groupTabs[1].id).map(entry => entry.id));
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('bulk-closes the whole group when the active tab belongs to another group', () => {
        const groupTabs = files();
        const shell = tab('terminal', 'Shell');
        const { props } = renderStrip({ tabs: Object.freeze([shell, ...groupTabs]), activeId: shell.id });
        fireEvent.click(overflow());
        fireEvent.click(screen.getByRole('button', { name: 'Close all in group' }));
        expect(props.onCloseMany).toHaveBeenCalledWith(groupTabs.map(entry => entry.id));
    });

    it('dismisses the overflow with Escape or outside click without activating a tab', async () => {
        const { props } = renderStrip();
        fireEvent.keyDown(overflow(), { key: 'ArrowDown' });
        expect(screen.getByRole('listbox', { name: 'Files tabs' })).toBeTruthy();
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        await Promise.resolve();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(overflow());
        fireEvent.click(overflow());
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(props.onActivate).not.toHaveBeenCalled();
    });

    it('announces hidden dirty and unavailable resources on +N and in the full list', () => {
        const tabs = files();
        renderStrip({ tabs, activeId: tabs[0].id, dirtyIds: new Set([tabs[3].id]), errorIds: new Set([tabs[4].id]) });
        expect(within(overflow()).getByLabelText('Hidden unsaved changes')).toHaveTextContent('●');
        expect(within(overflow()).getByLabelText('Hidden unavailable tabs')).toHaveTextContent('⚠');
        fireEvent.click(overflow());
        expect(screen.getByRole('option', { name: /file-4.ts.*unsaved changes/ })).toBeTruthy();
        expect(screen.getByRole('option', { name: /file-5.ts.*unavailable/ })).toBeTruthy();
    });

    it('does not mark overflow for dirty or errored resources already visible in the strip', () => {
        const tabs = files();
        renderStrip({ tabs, activeId: tabs[0].id, dirtyIds: new Set([tabs[0].id]), errorIds: new Set([tabs[1].id]) });
        expect(within(overflow()).queryByLabelText('Hidden unsaved changes')).toBeNull();
        expect(within(overflow()).queryByLabelText('Hidden unavailable tabs')).toBeNull();
        expect(screen.getByTestId(`unified-panel-tab-dirty-${tabs[0].id}`)).toHaveTextContent('●');
        expect(screen.getByTestId(`unified-panel-tab-error-${tabs[1].id}`)).toHaveTextContent('⚠');
    });

    it('folds to the active and pinned tabs, reports callbacks and announcements, and preserves saved order', () => {
        const tabs = files();
        const savedOrder = JSON.stringify(tabs.map(entry => entry.id));
        const { props } = renderStrip({ tabs, activeId: tabs[4].id, pinnedId: tabs[3].id }, true);
        const label = screen.getByRole('button', { name: 'Files, 5 tabs' });
        fireEvent.click(label);
        expect(props.onToggleGroup).toHaveBeenCalledWith('files');
        expect(label).toHaveAttribute('aria-expanded', 'false');
        expect(shownIds('files')).toEqual([tabs[3].id, tabs[4].id]);
        expect(tabNode(tabs[3])).toHaveAttribute('draggable', 'false');
        expect(screen.queryByTestId('unified-panel-group-overflow-files')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Files folded.');
        fireEvent.click(label);
        expect(label).toHaveAttribute('aria-expanded', 'true');
        expect(shownIds('files')).toHaveLength(3);
        expect(screen.getByRole('status')).toHaveTextContent('Files expanded.');
        expect(screen.getByTestId('saved-tab-order')).toHaveTextContent(savedOrder);
        expect(props.onMove).not.toHaveBeenCalled();
        expect(props.onActivate).not.toHaveBeenCalled();
    });

    it('keeps a folded inactive group label without exposing its ordinary tabs or overflow', () => {
        const shell = tab('terminal', 'Shell');
        renderStrip({ tabs: [shell, ...files()], activeId: shell.id, foldedGroups: new Set(['files']) });
        expect(shownIds('files')).toEqual([]);
        expect(screen.getByRole('button', { name: 'Files, 5 tabs' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('unified-panel-group-overflow-files')).toBeNull();
        expect(tabNode(shell)).toHaveAttribute('aria-selected', 'true');
    });

    it('rejects cross-group dragging and clears an existing drop marker', () => {
        const tabs = files(2);
        const shell = tab('terminal', 'Shell');
        const { props } = renderStrip({ tabs: [shell, ...tabs], activeId: tabs[0].id });
        const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
        fireEvent.dragStart(tabNode(tabs[0]), { dataTransfer });
        fireEvent.dragOver(tabNode(tabs[1]), { dataTransfer, clientX: 10 });
        expect(screen.getByTestId('unified-panel-tab-drop-indicator')).toBeTruthy();
        expect(fireEvent.dragOver(tabNode(shell), { dataTransfer, clientX: 10 })).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
        expect(screen.queryByTestId('unified-panel-tab-drop-indicator')).toBeNull();
        fireEvent.drop(tabNode(shell), { dataTransfer, clientX: 10 });
        expect(props.onMove).not.toHaveBeenCalled();
        expect(screen.queryByTestId('unified-panel-tab-drop-indicator')).toBeNull();
    });

    it('uses group-local after-target ids for drops even when other kinds are interleaved in saved order', () => {
        const tabs = files(3);
        const shell = tab('terminal', 'Shell');
        const web = tab('browser', 'Website');
        const { props } = renderStrip({ tabs: [tabs[0], shell, tabs[1], web, tabs[2]] });
        fireEvent.dragStart(tabNode(tabs[0]));
        fireEvent.drop(tabNode(tabs[1]), { clientX: 20 });
        expect(props.onMove).toHaveBeenLastCalledWith(tabs[0].id, tabs[2].id);
        fireEvent.dragStart(tabNode(tabs[0]));
        fireEvent.drop(tabNode(tabs[2]), { clientX: 20 });
        expect(props.onMove).toHaveBeenLastCalledWith(tabs[0].id, null);
    });

    it('stops Alt arrows at group edges and targets hidden neighbours within the same group', () => {
        const tabs = files();
        const shell = tab('terminal', 'Shell');
        const { props } = renderStrip({ tabs: [tabs[0], shell, ...tabs.slice(1)], activeId: tabs[4].id });
        fireEvent.keyDown(tabNode(shell), { key: 'ArrowRight', altKey: true });
        fireEvent.keyDown(tabNode(tabs[0]), { key: 'ArrowLeft', altKey: true });
        fireEvent.keyDown(tabNode(tabs[4]), { key: 'ArrowRight', altKey: true });
        expect(props.onMove).not.toHaveBeenCalled();
        fireEvent.keyDown(tabNode(tabs[1]), { key: 'ArrowRight', altKey: true });
        expect(props.onMove).toHaveBeenLastCalledWith(tabs[1].id, tabs[3].id);
        expect(screen.getByRole('status')).toHaveTextContent('Position 3 of 5.');
        fireEvent.keyDown(tabNode(tabs[4]), { key: 'ArrowLeft', altKey: true });
        expect(props.onMove).toHaveBeenLastCalledWith(tabs[4].id, tabs[3].id);
    });

    it('traverses group labels, tabs and +N with arrow keys, Home and End without activating labels', () => {
        const tabs = files();
        const shell = tab('terminal', 'Shell');
        const { props } = renderStrip({ tabs: [shell, ...tabs], activeId: tabs[0].id });
        const toolsLabel = screen.getByRole('button', { name: 'Tools, 1 tabs' });
        const filesLabel = screen.getByRole('button', { name: 'Files, 5 tabs' });
        toolsLabel.focus();
        fireEvent.keyDown(toolsLabel, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(tabNode(shell));
        expect(props.onActivate).toHaveBeenLastCalledWith(shell.id);
        vi.mocked(props.onActivate).mockClear();
        fireEvent.keyDown(tabNode(shell), { key: 'ArrowRight' });
        expect(document.activeElement).toBe(filesLabel);
        expect(props.onActivate).not.toHaveBeenCalled();
        fireEvent.keyDown(filesLabel, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(tabNode(tabs[0]));
        expect(props.onActivate).toHaveBeenLastCalledWith(tabs[0].id);
        vi.mocked(props.onActivate).mockClear();
        fireEvent.keyDown(tabNode(tabs[0]), { key: 'End' });
        expect(document.activeElement).toBe(overflow());
        expect(props.onActivate).not.toHaveBeenCalled();
        fireEvent.keyDown(overflow(), { key: 'ArrowRight' });
        expect(document.activeElement).toBe(toolsLabel);
        fireEvent.keyDown(toolsLabel, { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(overflow());
        fireEvent.keyDown(overflow(), { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(tabNode(tabs[2]));
        expect(props.onActivate).toHaveBeenLastCalledWith(tabs[2].id);
        fireEvent.keyDown(tabNode(tabs[2]), { key: 'Home' });
        expect(document.activeElement).toBe(toolsLabel);
    });

    it('offers group bulk commands and disables moves at group boundaries, not global boundaries', () => {
        const tabs = files();
        const shell = tab('terminal', 'Shell');
        const { props } = renderStrip({ tabs: [shell, ...tabs], activeId: tabs[4].id });
        fireEvent.contextMenu(tabNode(tabs[0]));
        expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
        expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeEnabled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Close all in group' }));
        expect(props.onMenuAction).toHaveBeenCalledWith('close-group', tabs[0].id);
        expect(unifiedPanelBulkCloseTargets(props.tabs, tabs[0].id, 'close-group', new Set()))
            .toEqual(tabs.map(entry => entry.id));
        fireEvent.contextMenu(tabNode(tabs[4]));
        expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeDisabled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Close others in group' }));
        expect(props.onMenuAction).toHaveBeenCalledWith('close-others-in-group', tabs[4].id);
        expect(unifiedPanelBulkCloseTargets(props.tabs, tabs[4].id, 'close-others-in-group', new Set([tabs[3].id])))
            .toEqual(tabs.slice(0, 4).map(entry => entry.id));
        fireEvent.contextMenu(tabNode(shell));
        expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
        expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeDisabled();
        expect(screen.getByRole('menuitem', { name: 'Close others in group' })).toBeDisabled();
        expect(screen.getByRole('menuitem', { name: 'Close all in group' })).toBeEnabled();
    });
});

describe('UnifiedPanelTabStrip group block reordering', () => {
    const tools = [tab('terminal', 'Shell')];
    const fileTabs = [tab('file', 'a.ts'), tab('file', 'b.ts'), tab('file', 'c.ts')];
    const web = ['Google', 'Bing', 'YouTube', 'Docs'].map(label => tab('browser', label));
    const tabs = Object.freeze([...tools, ...fileTabs, ...web]);
    const folded = new Set<UnifiedTabStripGroup>(['tools', 'files']);

    function Harness({ scope, ...props }: { scope: string } & Partial<UnifiedPanelTabStripProps>) {
        const order = useUnifiedTabGroupOrder(scope);
        return <UnifiedPanelTabStrip
            tabs={tabs} activeId={web[1].id} groupsEnabled foldedGroups={folded}
            onActivate={vi.fn()} onClose={vi.fn()} onCloseMany={vi.fn()} onMove={vi.fn()}
            groupOrder={order} onMoveGroup={(group, before) => moveTabGroup(scope, group, before)}
            {...props}
        />;
    }

    function renderHarness(props: Partial<UnifiedPanelTabStripProps> = {}, scope = 'host-a:workspace') {
        const handlers = { onActivate: vi.fn(), onToggleGroup: vi.fn(), ...props };
        const view = render(<Harness scope={scope} {...handlers} />);
        return { ...view, handlers };
    }

    const blockOrder = () => screen.getAllByRole('group').map(node => node.getAttribute('data-strip-group'));
    const label = (group: UnifiedTabStripGroup) => screen.getByTestId(`unified-panel-group-${group}`);

    /** Lays the rendered blocks out 100px apart in DOM order (jsdom has no layout). */
    function layoutBlocks() {
        screen.getAllByRole('group').forEach((node, index) => {
            node.getBoundingClientRect = () => ({ left: index * 100, right: index * 100 + 100, width: 100 } as DOMRect);
        });
    }

    function drag(group: UnifiedTabStripGroup, fromX: number, toX: number) {
        layoutBlocks();
        fireEvent.pointerDown(label(group), { button: 0, clientX: fromX });
        fireEvent.pointerMove(window, { clientX: toX });
    }

    afterEach(() => {
        cleanup();
        clearUnifiedTabGroupState();
        localStorage.clear();
    });

    it('drags Web before Tools as one block, keeping members, active tab, folds, overflow and tab nodes', () => {
        const { handlers } = renderHarness();
        expect(blockOrder()).toEqual(['tools', 'files', 'web']);
        const activeNode = tabNode(web[1]);
        const shownWeb = shownIds('web');
        expect(overflow('web')).toHaveTextContent('+1');

        drag('web', 250, 30);
        const indicator = screen.getByTestId('unified-panel-group-drop-indicator');
        expect(indicator).toHaveAttribute('data-position', 'before');
        expect(screen.getByRole('group', { name: /^Tools/ })).toContainElement(indicator);
        expect(screen.getByRole('group', { name: /^Web/ })).toHaveAttribute('data-dragging', 'true');
        fireEvent.pointerUp(window);
        // The click that ends a drag must not fold the group.
        fireEvent.click(label('web'));

        expect(blockOrder()).toEqual(['web', 'tools', 'files']);
        expect(readUnifiedTabGroupOrder('host-a:workspace')).toEqual(['web', 'tools', 'files', 'canvas']);
        expect(shownIds('web')).toEqual(shownWeb);
        expect(tabNode(web[1])).toBe(activeNode);
        expect(activeNode).toHaveAttribute('aria-selected', 'true');
        expect(label('tools')).toHaveAttribute('aria-expanded', 'false');
        expect(label('files')).toHaveAttribute('aria-expanded', 'false');
        expect(overflow('web')).toHaveTextContent('+1');
        fireEvent.click(overflow('web'));
        expect(screen.getAllByRole('option').map(node => node.textContent)).toEqual([expect.stringContaining('Docs')]);
        expect(screen.queryByTestId('unified-panel-group-drop-indicator')).toBeNull();
        expect(handlers.onToggleGroup).not.toHaveBeenCalled();
        expect(handlers.onActivate).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Web group moved. Position 1 of 3.');
    });

    it('drops after a block onto the following block slot', () => {
        renderHarness();
        drag('tools', 50, 280);
        expect(screen.getByTestId('unified-panel-group-drop-indicator')).toHaveAttribute('data-position', 'after');
        fireEvent.pointerUp(window);
        expect(blockOrder()).toEqual(['files', 'web', 'tools']);
    });

    it('treats movement under the threshold as a click that folds or expands', () => {
        const { handlers } = renderHarness();
        drag('web', 250, 253);
        expect(screen.queryByTestId('unified-panel-group-drop-indicator')).toBeNull();
        expect(screen.getByRole('group', { name: /^Web/ })).not.toHaveAttribute('data-dragging');
        fireEvent.pointerUp(window);
        fireEvent.click(label('web'));
        expect(handlers.onToggleGroup).toHaveBeenCalledWith('web');
        expect(blockOrder()).toEqual(['tools', 'files', 'web']);
        expect(localStorage.length).toBe(0);
    });

    it('cancels with Escape or pointercancel without moving, folding or activating', () => {
        const { handlers } = renderHarness();
        drag('web', 250, 30);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('unified-panel-group-drop-indicator')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Group move cancelled.');
        fireEvent.pointerUp(window);
        fireEvent.click(label('web'));

        drag('files', 150, 10);
        fireEvent.pointerCancel(window);
        fireEvent.pointerUp(window);

        expect(blockOrder()).toEqual(['tools', 'files', 'web']);
        expect(localStorage.length).toBe(0);
        expect(handlers.onToggleGroup).not.toHaveBeenCalled();
        expect(handlers.onActivate).not.toHaveBeenCalled();
    });

    it('does not write a move when the block drops back into its own slot', () => {
        renderHarness();
        drag('files', 150, 220);
        expect(screen.getByTestId('unified-panel-group-drop-indicator')).toHaveAttribute('data-position', 'before');
        fireEvent.pointerUp(window);
        drag('files', 150, 160);
        expect(screen.queryByTestId('unified-panel-group-drop-indicator')).toBeNull();
        fireEvent.pointerUp(window);
        expect(localStorage.length).toBe(0);
        expect(screen.getByRole('status')).toHaveTextContent('Group move cancelled.');
    });

    it('moves the focused group with Alt+Arrow, keeps focus and stops at the edges', async () => {
        renderHarness();
        const webLabel = label('web');
        expect(webLabel).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
        webLabel.focus();
        fireEvent.keyDown(webLabel, { key: 'ArrowLeft', altKey: true });
        expect(blockOrder()).toEqual(['tools', 'web', 'files']);
        expect(screen.getByRole('status')).toHaveTextContent('Web group moved left. Position 2 of 3.');
        fireEvent.keyDown(label('web'), { key: 'ArrowLeft', altKey: true });
        fireEvent.keyDown(label('web'), { key: 'ArrowLeft', altKey: true });
        expect(blockOrder()).toEqual(['web', 'tools', 'files']);
        await act(async () => { await Promise.resolve(); });
        expect(document.activeElement).toBe(label('web'));
        fireEvent.keyDown(label('web'), { key: 'ArrowRight', altKey: true });
        expect(blockOrder()).toEqual(['tools', 'web', 'files']);
        // Plain arrows still traverse stops rather than moving blocks.
        fireEvent.keyDown(label('web'), { key: 'ArrowRight' });
        expect(blockOrder()).toEqual(['tools', 'web', 'files']);
        expect(label('tools')).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps group order per workspace and reconciles groups that appear later', () => {
        const { unmount } = renderHarness();
        drag('web', 250, 30);
        fireEvent.pointerUp(window);
        expect(blockOrder()).toEqual(['web', 'tools', 'files']);
        unmount();

        renderHarness({}, 'host-b:workspace');
        expect(blockOrder()).toEqual(['tools', 'files', 'web']);
        cleanup();

        renderHarness({ tabs: [...tabs, tab('canvas', 'Diagram')] });
        expect(blockOrder()).toEqual(['web', 'tools', 'files', 'canvas']);
    });

    it('offers no group drag handle with a single group or without a move callback', () => {
        renderHarness({ tabs: web });
        expect(label('web')).not.toHaveAttribute('aria-keyshortcuts');
        cleanup();
        render(<UnifiedPanelTabStrip tabs={tabs} activeId={null} groupsEnabled onActivate={vi.fn()} onClose={vi.fn()}
            onCloseMany={vi.fn()} onMove={vi.fn()} />);
        expect(label('web')).not.toHaveAttribute('aria-keyshortcuts');
        fireEvent.keyDown(label('web'), { key: 'ArrowLeft', altKey: true });
        expect(blockOrder()).toEqual(['tools', 'files', 'web']);
    });
});

describe('UnifiedPanelTabStrip folded group menu', () => {
    afterEach(() => {
        cleanup();
        clearUnifiedTabGroupState();
        localStorage.clear();
    });

    const shell = tab('terminal', 'Shell');
    const groupMenu = (group: UnifiedTabStripGroup = 'files') => screen.getByTestId(`unified-panel-group-menu-${group}`);
    const optionNames = () => screen.getAllByRole('option').map(node => node.textContent);

    it('appears only on folded groups and only when groups are enabled', () => {
        const tabs = files();
        const { unmount } = renderStrip({ tabs: [shell, ...tabs], activeId: shell.id, foldedGroups: new Set(['files']) });
        expect(groupMenu()).toHaveAttribute('aria-label', 'Show all 5 Files tabs');
        expect(groupMenu()).toHaveAttribute('aria-haspopup', 'listbox');
        expect(screen.queryByTestId('unified-panel-group-menu-tools')).toBeNull();
        unmount();
        renderStrip({ tabs: [shell, ...tabs], activeId: shell.id, groupsEnabled: false, foldedGroups: new Set(['files']) });
        expect(screen.queryByTestId('unified-panel-group-menu-files')).toBeNull();
    });

    it('lists every tab with icons and activates one without expanding the group', () => {
        const tabs = files();
        const { props } = renderStrip({ tabs: [shell, ...tabs], activeId: tabs[1].id, foldedGroups: new Set(['files']) }, true);
        const label = screen.getByRole('button', { name: 'Files, 5 tabs' });
        expect(shownIds('files')).toEqual([tabs[1].id]);
        fireEvent.click(groupMenu());
        expect(screen.getByRole('listbox', { name: 'Files tabs' })).toBeTruthy();
        expect(screen.getByText('5 open')).toBeTruthy();
        expect(optionNames()).toEqual(tabs.map(entry => expect.stringContaining(entry.label)));
        expect(screen.getByRole('option', { name: /file-2.ts.*\(active\)/ })).toHaveAttribute('aria-selected', 'true');
        expect(within(screen.getByTestId(`unified-panel-group-menu-files-row-${tabs[3].id}`)).getByTestId('file-type-icon')).toBeTruthy();
        // Strip icon ids stay unique while the menu is open.
        expect(screen.getAllByTestId(`unified-panel-tab-file-icon-${tabs[1].id}`)).toHaveLength(1);

        fireEvent.click(screen.getByRole('option', { name: /file-4.ts/ }));
        expect(props.onActivate).toHaveBeenCalledWith(tabs[3].id);
        expect(props.onToggleGroup).not.toHaveBeenCalled();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(label).toHaveAttribute('aria-expanded', 'false');
        expect(shownIds('files')).toEqual([tabs[3].id]);
        expect(tabNode(tabs[3])).toHaveAttribute('aria-selected', 'true');
    });

    it('opens from the keyboard, searches, activates with Enter and returns focus', async () => {
        const tabs = files();
        const { props } = renderStrip({ tabs: [shell, ...tabs], activeId: shell.id, foldedGroups: new Set(['files']) });
        groupMenu().focus();
        fireEvent.keyDown(groupMenu(), { key: 'ArrowDown' });
        const search = screen.getByRole('textbox', { name: 'Search files tabs' });
        fireEvent.change(search, { target: { value: 'file-5' } });
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(props.onActivate).toHaveBeenCalledWith(tabs[4].id);
        expect(props.onToggleGroup).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(document.activeElement).toBe(groupMenu());
    });

    it('dismisses with Escape or outside press without activating, toggling or moving', async () => {
        const tabs = files();
        const onMoveGroup = vi.fn();
        const { props } = renderStrip({ tabs: [shell, ...tabs], activeId: shell.id, foldedGroups: new Set(['files']), onMoveGroup });
        fireEvent.pointerDown(groupMenu(), { button: 0, clientX: 10 });
        fireEvent.pointerMove(window, { clientX: 200 });
        fireEvent.pointerUp(window);
        fireEvent.click(groupMenu());
        expect(screen.getByRole('listbox')).toBeTruthy();
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        await Promise.resolve();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(groupMenu());
        fireEvent.click(groupMenu());
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(props.onActivate).not.toHaveBeenCalled();
        expect(props.onToggleGroup).not.toHaveBeenCalled();
        expect(onMoveGroup).not.toHaveBeenCalled();
    });

    it('keeps the menu inside the viewport near the right edge', () => {
        renderStrip({ tabs: [shell, ...files()], activeId: shell.id, foldedGroups: new Set(['files']) });
        groupMenu().getBoundingClientRect = () => ({ left: window.innerWidth - 4, right: window.innerWidth + 16, bottom: window.innerHeight - 2 } as DOMRect);
        fireEvent.click(groupMenu());
        const menu = screen.getByTestId('unified-panel-group-menu-files-menu');
        expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 328);
        expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
        expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 420);
    });

    it('serves Tools, Web and Canvas groups and closes rows through the strip callbacks', () => {
        const web = [tab('browser', 'Google'), tab('browser', 'Docs')];
        const canvas = [tab('canvas', 'Plan')];
        const { props } = renderStrip({
            tabs: [shell, ...web, ...canvas], activeId: null,
            foldedGroups: new Set(['tools', 'web', 'canvas']), hideBrowserRepoLabels: true,
        });
        for (const [group, entries] of [['tools', [shell]], ['web', web], ['canvas', canvas]] as const) {
            fireEvent.click(groupMenu(group));
            expect(optionNames()).toEqual(entries.map(entry => expect.stringContaining(entry.label)));
            fireEvent.mouseDown(document.body);
        }
        fireEvent.click(groupMenu('web'));
        fireEvent.click(screen.getByTestId(`unified-panel-group-menu-web-close-${web[1].id}`));
        expect(props.onClose).toHaveBeenCalledWith(web[1].id);
    });

    it('shows file paths on menu rows and the highlighted row, without titles on non-file rows', () => {
        const note = tab('note', 'plan.md', { resourceId: 'auto||docs/plans/plan.md', repoLabel: 'api' });
        const paste = tab('paste', 'Clip');
        const tabs = files(3);
        renderStrip({ tabs: [shell, note, paste, ...tabs], activeId: shell.id, foldedGroups: new Set(['files']) });
        fireEvent.keyDown(groupMenu(), { key: 'ArrowDown' });
        const option = (name: RegExp) => screen.getByRole('option', { name });
        expect(option(/plan\.md/)).toHaveAttribute('title', 'api: docs/plans/plan.md');
        expect(option(/file-2\.ts/)).toHaveAttribute('title', 'file-2.ts');
        expect(option(/Clip/)).not.toHaveAttribute('title');
        expect(screen.getByTestId('unified-panel-group-menu-files-detail')).toHaveTextContent('api: docs/plans/plan.md');
        const search = screen.getByRole('textbox');
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(screen.queryByTestId('unified-panel-group-menu-files-detail')).toBeNull();
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(screen.getByTestId('unified-panel-group-menu-files-detail')).toHaveTextContent('file-1.ts');
    });

    it('shows hidden file paths in the expanded group +N menu', () => {
        const tabs = files().map((entry, index) => index === 4 ? { ...entry, resourceId: 'src/deep/file-5.ts', repoLabel: 'web' } : entry);
        renderStrip({ tabs, activeId: tabs[0].id });
        fireEvent.click(overflow());
        expect(screen.getByRole('option', { name: /file-5\.ts/ })).toHaveAttribute('title', 'web: src/deep/file-5.ts');
    });
});

