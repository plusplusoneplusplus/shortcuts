// @vitest-environment jsdom
/**
 * The Search view in a narrow sidebar. At ~250px the query box had roughly 80px
 * of typing room: an emoji, three mode toggles and a clear button ate the rest,
 * while the header row above it sat empty and the action strip spent a whole row
 * on six glyphs. These tests pin the layout that fixes it.
 *
 * The width comes from the rendered sidebar, with the persisted width used only
 * before the first measurement.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const treeSpy = vi.fn();
const searchFilesSpy = vi.fn();
const searchContentSpy = vi.fn();
const measuredWidth = vi.hoisted(() => ({ value: 0 }));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
    useContainerWidth: () => ({
        width: measuredWidth.value,
        tier: measuredWidth.value < 500 ? 'narrow' : 'medium',
        isWide: false,
        isMedium: measuredWidth.value >= 500,
        isNarrow: measuredWidth.value < 500,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchFilesSpy(...args),
        searchContent: (...args: unknown[]) => searchContentSpy(...args),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: () => <div data-testid="preview-stub" />,
}));

import {
    ExplorerPanel,
    NARROW_SIDEBAR_WIDTH,
    isNarrowSidebar,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-narrow';

const ROOT_ENTRIES: TreeEntry[] = [{ name: 'README.md', type: 'file', path: 'README.md' }];

/** Render at a given persisted sidebar width, already switched to Search. */
async function renderSearchAt(width: number) {
    localStorage.setItem('explorer-sidebar-width', String(width));
    render(<ExplorerPanel workspaceId={WS} mode="editor" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByTestId('explorer-view-search'));
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerContentResults();
    measuredWidth.value = 0;
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchFilesSpy.mockReset();
    searchFilesSpy.mockResolvedValue({ results: [] });
    searchContentSpy.mockReset();
    searchContentSpy.mockResolvedValue({ matches: [], truncated: false });
});

afterEach(cleanup);

describe('isNarrowSidebar', () => {
    it('folds measured widths below the threshold', () => {
        expect(isNarrowSidebar(250)).toBe(true);
        expect(isNarrowSidebar(380)).toBe(true);
        expect(isNarrowSidebar(500)).toBe(false);
        expect(isNarrowSidebar(NARROW_SIDEBAR_WIDTH)).toBe(false);
    });
});

describe('ExplorerPanel — Search action strip in the header', () => {
    it('renders the search toolbar in the header row, not in the panel body', async () => {
        await renderSearchAt(400);
        const slot = screen.getByTestId('explorer-search-toolbar-slot');
        const toolbar = screen.getByTestId('content-search-toolbar');
        expect(slot.contains(toolbar)).toBe(true);
        expect(screen.getByTestId('content-search-panel').contains(toolbar)).toBe(false);
    });

    it('drops the tree buttons in Search view, and the search strip in Files view', async () => {
        await renderSearchAt(400);
        expect(screen.queryByTestId('explorer-collapse-all-btn')).toBeNull();
        expect(screen.queryByTestId('explorer-reveal-file-btn')).toBeNull();
        expect(screen.queryByTestId('explorer-refresh-btn')).toBeNull();

        fireEvent.click(screen.getByTestId('explorer-view-tree'));
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByTestId('explorer-refresh-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('content-search-toolbar')).toBeNull();
        expect(screen.queryByTestId('explorer-search-toolbar-slot')).toBeNull();
    });
});

describe('ExplorerPanel — Search layout by sidebar width', () => {
    it('folds at 380px: toggles below the box, ⋯ beside them, actions behind ⋯', async () => {
        await renderSearchAt(380);

        const row = screen.getByTestId('content-search-toggle-row');
        expect(row.contains(screen.getByTestId('content-search-toggle-case'))).toBe(true);
        expect(row.contains(screen.getByTestId('content-search-toggle-regex'))).toBe(true);
        // The `…` shares the toggle row rather than taking one of its own.
        expect(row.contains(screen.getByTestId('content-search-filters-toggle'))).toBe(true);
        expect(document.querySelectorAll('[data-testid="content-search-filters-toggle"]')).toHaveLength(1);

        const input = screen.getByTestId('content-search-input') as HTMLTextAreaElement;
        expect(input.style.paddingRight).toBe('28px');

        expect(screen.getByTestId('content-search-more')).toBeInTheDocument();
        expect(screen.queryByTestId('content-search-collapse-all')).toBeNull();
    });

    it('keeps the desktop shape at 500px', async () => {
        await renderSearchAt(500);

        expect(screen.queryByTestId('content-search-toggle-row')).toBeNull();
        const input = screen.getByTestId('content-search-input') as HTMLTextAreaElement;
        expect(input.style.paddingRight).toBe('132px');

        expect(screen.queryByTestId('content-search-more')).toBeNull();
        expect(screen.getByTestId('content-search-collapse-all')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-testid="content-search-filters-toggle"]')).toHaveLength(1);
    });

    it('uses the measured panel width instead of a wider persisted width', async () => {
        measuredWidth.value = 380;
        await renderSearchAt(500);
        expect(screen.getByTestId('content-search-toggle-row')).toBeInTheDocument();
        expect(screen.getByTestId('content-search-more')).toBeInTheDocument();
    });

    it('still runs the query typed in the folded layout', async () => {
        vi.useFakeTimers();
        try {
            await renderSearchAt(380);
            fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
            await act(async () => { await vi.advanceTimersByTimeAsync(500); });
            expect(searchContentSpy).toHaveBeenCalledWith(WS, 'needle', expect.anything(), undefined);

            // The refresh button reached the header's slot with its handler intact.
            fireEvent.click(screen.getByTestId('content-search-refresh'));
            await act(async () => { await vi.advanceTimersByTimeAsync(500); });
            expect(searchContentSpy).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
