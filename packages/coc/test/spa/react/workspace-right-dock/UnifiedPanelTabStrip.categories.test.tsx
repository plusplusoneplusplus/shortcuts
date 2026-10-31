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
import {
    scopeForKind,
    type UnifiedPanelTab,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function tab(kind: UnifiedPanelTab['kind'], label: string): UnifiedPanelTab {
    return Object.freeze({
        id: `${kind}:${label}`, kind, label, resourceId: label,
        ownerWorkspaceId: 'workspace', chatId: scopeForKind(kind) === 'workspace' ? null : 'chat',
    });
}

const terminal = tab('terminal', 'Terminal');
const fileA = tab('file', 'a.ts');
const fileB = tab('file', 'b.ts');
const fileC = tab('file', 'c.ts');
const fileD = tab('file', 'd.ts');
const pageA = tab('browser', 'Docs');
const pageB = tab('browser', 'PR');
const TABS = Object.freeze([terminal, fileA, fileB, fileC, fileD, pageA, pageB]);

function renderStrip(overrides: Partial<UnifiedPanelTabStripProps> = {}) {
    const props = {
        tabs: TABS,
        activeId: fileA.id as string | null,
        categoriesEnabled: true,
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onCloseMany: vi.fn(),
        onMove: vi.fn(),
        ...overrides,
    };
    function Harness() {
        const [activeId, setActiveId] = useState(props.activeId);
        const [tabs, setTabs] = useState(props.tabs);
        return <UnifiedPanelTabStrip {...props}
            tabs={tabs}
            activeId={activeId}
            onActivate={id => { props.onActivate(id); setActiveId(id); }}
            onClose={id => { props.onClose(id); setTabs(current => current.filter(entry => entry.id !== id)); }}
        />;
    }
    return { ...render(<Harness />), props };
}

const chip = (group: string) => screen.getByTestId(`unified-panel-category-${group}`);
const chipTabId = (group: string) => within(chip(group)).getByRole('tab').getAttribute('data-tab-id');

describe('UnifiedPanelTabStrip categories', () => {
    afterEach(cleanup);

    it('renders one chip per nonempty category, each showing a single tab', () => {
        renderStrip();
        expect(screen.getAllByRole('group').map(node => node.dataset.stripGroup)).toEqual(['tools', 'files', 'web']);
        expect(screen.queryByTestId('unified-panel-category-canvas')).toBeNull();
        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(chipTabId('files')).toBe(fileA.id);
        expect(chip('files')).toHaveAttribute('data-active', 'true');
        expect(chip('web')).not.toHaveAttribute('data-active');
    });

    it('switches between a web page and a source file with one click each, keeping each chip on its last tab', () => {
        const { props } = renderStrip();
        fireEvent.click(screen.getByTestId('unified-panel-category-menu-files'));
        fireEvent.click(within(screen.getByTestId('unified-panel-tab-overflow-results')).getByText('c.ts'));
        expect(props.onActivate).toHaveBeenLastCalledWith(fileC.id);

        fireEvent.click(screen.getByTestId('unified-panel-category-menu-web'));
        fireEvent.click(within(screen.getByTestId('unified-panel-tab-overflow-results')).getByText('Docs'));
        expect(props.onActivate).toHaveBeenLastCalledWith(pageA.id);
        // The Files chip still names c.ts, not the newest or first file.
        expect(chipTabId('files')).toBe(fileC.id);

        fireEvent.click(within(chip('files')).getByRole('tab'));
        expect(props.onActivate).toHaveBeenLastCalledWith(fileC.id);
        fireEvent.click(within(chip('web')).getByRole('tab'));
        expect(props.onActivate).toHaveBeenLastCalledWith(pageA.id);
    });

    it('offers a menu only for categories with more than one tab', () => {
        renderStrip();
        expect(screen.queryByTestId('unified-panel-category-menu-tools')).toBeNull();
        expect(screen.getByTestId('unified-panel-category-menu-files')).toHaveAccessibleName('All 4 Files tabs');
        expect(screen.getByTestId('unified-panel-category-menu-web')).toHaveTextContent('2');
    });

    it('lists the whole category in its menu, marking the chip tab and closing others around it', () => {
        const { props } = renderStrip({ activeId: pageB.id });
        fireEvent.click(screen.getByTestId('unified-panel-category-menu-files'));
        const results = screen.getByTestId('unified-panel-tab-overflow-results');
        expect(within(results).getAllByRole('option').map(node => node.textContent)).toEqual([
            expect.stringContaining('a.ts'), expect.stringContaining('b.ts'),
            expect.stringContaining('c.ts'), expect.stringContaining('d.ts'),
        ]);
        // No file is active, so the menu marks the chip's own tab (the newest).
        expect(within(results).getByRole('option', { selected: true })).toHaveTextContent('d.ts');
        fireEvent.click(screen.getByTestId('unified-panel-tab-overflow-close-others'));
        expect(props.onCloseMany).toHaveBeenCalledWith([fileA.id, fileB.id, fileC.id]);
    });

    it('marks hidden unsaved tabs on the category menu button', () => {
        renderStrip({ dirtyIds: new Set([fileB.id]) });
        expect(screen.getByTestId('unified-panel-category-dirty-files')).toBeInTheDocument();
        expect(screen.getByTestId('unified-panel-category-menu-files')).toHaveAccessibleName('All 4 Files tabs, some unsaved');
        expect(screen.queryByTestId('unified-panel-category-dirty-web')).toBeNull();
    });

    it('moves the chip to the next tab in its category when its tab closes', () => {
        renderStrip({ activeId: pageA.id });
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${pageA.id}`));
        expect(chipTabId('web')).toBe(pageB.id);
        expect(screen.queryByTestId('unified-panel-category-menu-web')).toBeNull();
    });

    it('moves focus and selection between chips and menu buttons with the arrow keys', async () => {
        const { props } = renderStrip();
        const files = within(chip('files')).getByRole('tab');
        files.focus();
        fireEvent.keyDown(files, { key: 'ArrowRight' });
        expect(screen.getByTestId('unified-panel-category-menu-files')).toHaveFocus();
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
        await act(async () => {});
        expect(props.onActivate).toHaveBeenLastCalledWith(pageB.id);
        expect(within(chip('web')).getByRole('tab')).toHaveFocus();
    });

    it('takes precedence over inline groups', () => {
        renderStrip({ groupsEnabled: true });
        expect(screen.queryByTestId('unified-panel-group-files')).toBeNull();
        expect(screen.queryByTestId('unified-panel-group-overflow-files')).toBeNull();
        expect(screen.getByTestId('unified-panel-category-files')).toBeInTheDocument();
    });

    it('renders the ordinary strip when the flag is off', () => {
        renderStrip({ categoriesEnabled: false });
        expect(screen.queryByTestId('unified-panel-category-files')).toBeNull();
        expect(screen.getAllByRole('tab')).toHaveLength(TABS.length);
    });
});
