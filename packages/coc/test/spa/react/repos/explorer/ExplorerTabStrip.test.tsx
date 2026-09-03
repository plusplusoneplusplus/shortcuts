import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
    ExplorerTabStrip,
    tabTooltip,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerTabStrip';
import {
    fileTabId,
    searchTabId,
    tabLabels,
    type ExplorerTab,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTabsModel';

function fileTab(path: string, overrides: Partial<ExplorerTab> = {}): ExplorerTab {
    return {
        id: fileTabId(path),
        kind: 'file',
        path,
        name: path.split('/').pop() ?? path,
        preview: false,
        readOnly: false,
        ...overrides,
    };
}

function searchTab(query: string): ExplorerTab {
    return {
        id: searchTabId(query),
        kind: 'search',
        path: '',
        name: `Search: ${query}`,
        preview: false,
        readOnly: true,
        query,
    };
}

interface Handlers {
    onActivate: ReturnType<typeof vi.fn>;
    onPin: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
    onCloseOthers: ReturnType<typeof vi.fn>;
    onCloseToRight: ReturnType<typeof vi.fn>;
    onCloseAll: ReturnType<typeof vi.fn>;
    onMove: ReturnType<typeof vi.fn>;
}

function handlers(): Handlers {
    return {
        onActivate: vi.fn(),
        onPin: vi.fn(),
        onClose: vi.fn(),
        onCloseOthers: vi.fn(),
        onCloseToRight: vi.fn(),
        onCloseAll: vi.fn(),
        onMove: vi.fn(),
    };
}

function renderStrip(
    tabs: ExplorerTab[],
    activeId: string | null,
    extra: Partial<ComponentProps<typeof ExplorerTabStrip>> = {},
) {
    const h = handlers();
    const view = render(
        <ExplorerTabStrip
            tabs={tabs}
            activeId={activeId}
            labels={tabLabels(tabs)}
            {...h}
            {...extra}
        />,
    );
    return { ...h, view };
}

/** testing-library has no `fireEvent.auxClick`, so dispatch the native event. */
function middleClick(element: Element, button = 1) {
    fireEvent(element, new MouseEvent('auxclick', { button, bubbles: true, cancelable: true }));
}

/** A DataTransfer stand-in: jsdom's drag events carry none. */
function dataTransfer() {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData: (type: string, value: string) => store.set(type, value),
        getData: (type: string) => store.get(type) ?? '',
    };
}

beforeEach(() => {
    cleanup();
});

describe('ExplorerTabStrip', () => {
    it('renders nothing when there are no tabs', () => {
        renderStrip([], null);
        expect(screen.queryByTestId('explorer-tab-strip')).toBeNull();
    });

    it('renders a tab per open buffer with ARIA tab semantics', () => {
        const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
        renderStrip(tabs, tabs[1].id);

        const list = screen.getByTestId('explorer-tab-list');
        expect(list.getAttribute('role')).toBe('tablist');
        expect(list.getAttribute('aria-orientation')).toBe('horizontal');

        const rendered = screen.getAllByRole('tab');
        expect(rendered).toHaveLength(2);
        expect(rendered[0].getAttribute('aria-selected')).toBe('false');
        expect(rendered[1].getAttribute('aria-selected')).toBe('true');
        // Only the active tab is in the page tab order (roving tabindex).
        expect(rendered[0].getAttribute('tabindex')).toBe('-1');
        expect(rendered[1].getAttribute('tabindex')).toBe('0');
    });

    it('labels tabs by filename and widens colliding names', () => {
        const tabs = [fileTab('src/index.ts'), fileTab('test/index.ts'), fileTab('src/only.ts')];
        renderStrip(tabs, tabs[0].id);

        expect(screen.getByTestId(`explorer-tab-label-${tabs[0].id}`).textContent).toBe('src/index.ts');
        expect(screen.getByTestId(`explorer-tab-label-${tabs[1].id}`).textContent).toBe('test/index.ts');
        expect(screen.getByTestId(`explorer-tab-label-${tabs[2].id}`).textContent).toBe('only.ts');
    });

    it('shows the full path as the tooltip', () => {
        const tabs = [fileTab('src/deep/nested/file.ts'), searchTab('needle')];
        renderStrip(tabs, tabs[0].id);

        expect(screen.getByTestId(`explorer-tab-${tabs[0].id}`).getAttribute('title')).toBe('src/deep/nested/file.ts');
        expect(screen.getByTestId(`explorer-tab-${tabs[1].id}`).getAttribute('title')).toBe('Search: needle');
        expect(tabTooltip(tabs[1])).toBe('Search: needle');
    });

    it('activates a tab on click and pins it on double click', () => {
        const tabs = [fileTab('src/a.ts', { preview: true }), fileTab('src/b.ts')];
        const { onActivate, onPin } = renderStrip(tabs, tabs[1].id);

        fireEvent.click(screen.getByTestId(`explorer-tab-${tabs[0].id}`));
        expect(onActivate).toHaveBeenCalledWith(tabs[0].id);

        fireEvent.doubleClick(screen.getByTestId(`explorer-tab-${tabs[0].id}`));
        expect(onPin).toHaveBeenCalledWith(tabs[0].id);
    });

    it('marks a preview tab italic and pinned tabs upright', () => {
        const tabs = [fileTab('src/a.ts', { preview: true }), fileTab('src/b.ts')];
        renderStrip(tabs, tabs[0].id);

        expect(screen.getByTestId(`explorer-tab-label-${tabs[0].id}`).className).toContain('italic');
        expect(screen.getByTestId(`explorer-tab-label-${tabs[1].id}`).className).not.toContain('italic');
        expect(screen.getByTestId(`explorer-tab-${tabs[0].id}`).getAttribute('data-preview')).toBe('true');
    });

    it('closes via the close button without activating the tab', () => {
        const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
        const { onClose, onActivate } = renderStrip(tabs, tabs[0].id);

        fireEvent.click(screen.getByTestId(`explorer-tab-close-${tabs[1].id}`));
        expect(onClose).toHaveBeenCalledWith(tabs[1].id);
        expect(onActivate).not.toHaveBeenCalled();
    });

    it('closes on middle click', () => {
        const tabs = [fileTab('src/a.ts')];
        const { onClose } = renderStrip(tabs, tabs[0].id);

        middleClick(screen.getByTestId(`explorer-tab-${tabs[0].id}`));
        expect(onClose).toHaveBeenCalledWith(tabs[0].id);
    });

    it('ignores an aux click that is not the middle button', () => {
        const tabs = [fileTab('src/a.ts')];
        const { onClose } = renderStrip(tabs, tabs[0].id);

        middleClick(screen.getByTestId(`explorer-tab-${tabs[0].id}`), 2);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows a dirty dot and still offers a labelled close control', () => {
        const tabs = [fileTab('src/a.ts')];
        renderStrip(tabs, tabs[0].id, { dirtyIds: new Set([tabs[0].id]) });

        expect(screen.getByTestId(`explorer-tab-dirty-${tabs[0].id}`)).toBeDefined();
        const close = screen.getByTestId(`explorer-tab-close-${tabs[0].id}`);
        // Hidden until hover/focus, but present so keyboard users can reach it.
        expect(close.className).toContain('group-hover:block');
        expect(close.getAttribute('aria-label')).toBe('Close a.ts');
        expect(screen.getByTestId(`explorer-tab-${tabs[0].id}`).textContent).toContain('unsaved changes');
    });

    it('has no dirty dot on a clean tab', () => {
        const tabs = [fileTab('src/a.ts')];
        renderStrip(tabs, tabs[0].id);
        expect(screen.queryByTestId(`explorer-tab-dirty-${tabs[0].id}`)).toBeNull();
    });

    it('marks read-only, loading and error tabs without relying on color', () => {
        const tabs = [fileTab('src/a.ts', { readOnly: true }), fileTab('src/b.ts'), fileTab('src/c.ts')];
        renderStrip(tabs, tabs[0].id, {
            loadingIds: new Set([tabs[1].id]),
            errorIds: new Set([tabs[2].id]),
        });

        expect(screen.getByTestId(`explorer-tab-readonly-${tabs[0].id}`).textContent).toBe('🔒');
        expect(screen.getByTestId(`explorer-tab-${tabs[0].id}`).textContent).toContain('read-only');
        expect(screen.getByTestId(`explorer-tab-${tabs[1].id}`).getAttribute('aria-busy')).toBe('true');
        expect(screen.getByTestId(`explorer-tab-${tabs[1].id}`).textContent).toContain('loading');
        expect(screen.getByTestId(`explorer-tab-error-${tabs[2].id}`).textContent).toBe('⚠');
        expect(screen.getByTestId(`explorer-tab-${tabs[2].id}`).textContent).toContain('failed to load');
    });

    describe('drag reorder', () => {
        it('reports the moved indices on drop', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts'), fileTab('src/c.ts')];
            const { onMove } = renderStrip(tabs, tabs[0].id);

            const dt = dataTransfer();
            fireEvent.dragStart(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { dataTransfer: dt });
            fireEvent.drop(screen.getByTestId(`explorer-tab-${tabs[2].id}`), { dataTransfer: dt });

            expect(onMove).toHaveBeenCalledWith(0, 2);
        });

        it('marks the dragged tab while a drag is in flight and clears it on drop', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
            renderStrip(tabs, tabs[0].id);

            const dt = dataTransfer();
            fireEvent.dragStart(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { dataTransfer: dt });
            expect(screen.getByTestId(`explorer-tab-${tabs[0].id}`).getAttribute('data-dragging')).toBe('true');

            fireEvent.drop(screen.getByTestId(`explorer-tab-${tabs[1].id}`), { dataTransfer: dt });
            expect(screen.getByTestId(`explorer-tab-${tabs[0].id}`).getAttribute('data-dragging')).toBeNull();
        });

        it('does not report a move when a tab is dropped on itself', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
            const { onMove } = renderStrip(tabs, tabs[0].id);

            const dt = dataTransfer();
            fireEvent.dragStart(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { dataTransfer: dt });
            fireEvent.drop(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { dataTransfer: dt });

            expect(onMove).not.toHaveBeenCalled();
        });

        it('ignores a drop carrying no tab index', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
            const { onMove } = renderStrip(tabs, tabs[0].id);

            fireEvent.drop(screen.getByTestId(`explorer-tab-${tabs[1].id}`), { dataTransfer: dataTransfer() });
            expect(onMove).not.toHaveBeenCalled();
        });
    });

    describe('context menu', () => {
        function openMenu(tab: ExplorerTab) {
            fireEvent.contextMenu(screen.getByTestId(`explorer-tab-${tab.id}`), { clientX: 12, clientY: 34 });
        }

        it('opens on right click and exposes the four close actions', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
            renderStrip(tabs, tabs[0].id);

            expect(screen.queryByTestId('explorer-tab-menu')).toBeNull();
            openMenu(tabs[0]);

            const menu = screen.getByTestId('explorer-tab-menu');
            expect(menu.getAttribute('role')).toBe('menu');
            expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
                'Close',
                'Close Others',
                'Close to the Right',
                'Close All',
            ]);
        });

        it.each([
            ['close', 'onClose' as const, true],
            ['close-others', 'onCloseOthers' as const, true],
            ['close-right', 'onCloseToRight' as const, true],
            ['close-all', 'onCloseAll' as const, false],
        ])('runs %s and dismisses the menu', (key, handler, takesId) => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
            const rendered = renderStrip(tabs, tabs[0].id);

            openMenu(tabs[1]);
            fireEvent.click(screen.getByTestId(`explorer-tab-menu-${key}`));

            if (takesId) expect(rendered[handler]).toHaveBeenCalledWith(tabs[1].id);
            else expect(rendered[handler]).toHaveBeenCalledWith();
            expect(screen.queryByTestId('explorer-tab-menu')).toBeNull();
        });

        it('dismisses on Escape and on an outside mousedown', () => {
            const tabs = [fileTab('src/a.ts')];
            renderStrip(tabs, tabs[0].id);

            openMenu(tabs[0]);
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(screen.queryByTestId('explorer-tab-menu')).toBeNull();

            openMenu(tabs[0]);
            fireEvent.mouseDown(document.body);
            expect(screen.queryByTestId('explorer-tab-menu')).toBeNull();
        });

        it('drops a menu whose tab disappeared', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
            const h = handlers();
            const view = render(
                <ExplorerTabStrip tabs={tabs} activeId={tabs[0].id} labels={tabLabels(tabs)} {...h} />,
            );
            openMenu(tabs[1]);
            expect(screen.getByTestId('explorer-tab-menu')).toBeDefined();

            const remaining = [tabs[0]];
            view.rerender(
                <ExplorerTabStrip tabs={remaining} activeId={tabs[0].id} labels={tabLabels(remaining)} {...h} />,
            );
            expect(screen.queryByTestId('explorer-tab-menu')).toBeNull();
        });
    });

    describe('keyboard', () => {
        it('activates with Enter and Space', () => {
            const tabs = [fileTab('src/a.ts')];
            const { onActivate } = renderStrip(tabs, null);

            fireEvent.keyDown(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { key: 'Enter' });
            fireEvent.keyDown(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { key: ' ' });
            expect(onActivate.mock.calls).toEqual([[tabs[0].id], [tabs[0].id]]);
        });

        it('walks the strip with arrow keys, wrapping at both ends', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts'), fileTab('src/c.ts')];
            const { onActivate } = renderStrip(tabs, tabs[0].id);

            fireEvent.keyDown(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { key: 'ArrowRight' });
            expect(onActivate).toHaveBeenLastCalledWith(tabs[1].id);

            fireEvent.keyDown(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { key: 'ArrowLeft' });
            expect(onActivate).toHaveBeenLastCalledWith(tabs[2].id);
        });

        it('jumps to the ends with Home and End', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts'), fileTab('src/c.ts')];
            const { onActivate } = renderStrip(tabs, tabs[1].id);

            fireEvent.keyDown(screen.getByTestId(`explorer-tab-${tabs[1].id}`), { key: 'End' });
            expect(onActivate).toHaveBeenLastCalledWith(tabs[2].id);

            fireEvent.keyDown(screen.getByTestId(`explorer-tab-${tabs[1].id}`), { key: 'Home' });
            expect(onActivate).toHaveBeenLastCalledWith(tabs[0].id);
        });

        it('leaves other keys to the browser', () => {
            const tabs = [fileTab('src/a.ts')];
            const { onActivate } = renderStrip(tabs, tabs[0].id);

            fireEvent.keyDown(screen.getByTestId(`explorer-tab-${tabs[0].id}`), { key: 'a' });
            expect(onActivate).not.toHaveBeenCalled();
        });
    });

    describe('overflow', () => {
        it('scrolls the strip horizontally rather than wrapping', () => {
            const tabs = [fileTab('src/a.ts')];
            renderStrip(tabs, tabs[0].id);
            expect(screen.getByTestId('explorer-tab-list').className).toContain('overflow-x-auto');
        });

        it('reveals the active tab when it changes', () => {
            const tabs = [fileTab('src/a.ts'), fileTab('src/b.ts')];
            const scrollIntoView = vi.fn();
            const proto = HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
            const original = proto.scrollIntoView;
            proto.scrollIntoView = scrollIntoView;
            try {

            const h = handlers();
            const view = render(
                <ExplorerTabStrip tabs={tabs} activeId={tabs[0].id} labels={tabLabels(tabs)} {...h} />,
            );
            scrollIntoView.mockClear();

            view.rerender(
                <ExplorerTabStrip tabs={tabs} activeId={tabs[1].id} labels={tabLabels(tabs)} {...h} />,
            );
            expect(scrollIntoView).toHaveBeenCalled();
            expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId(`explorer-tab-${tabs[1].id}`));
            } finally {
                if (original === undefined) delete proto.scrollIntoView;
                else proto.scrollIntoView = original;
            }
        });
    });
});
