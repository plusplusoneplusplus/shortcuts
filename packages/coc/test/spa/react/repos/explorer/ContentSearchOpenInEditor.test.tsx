// @vitest-environment jsdom
/**
 * §2.7's last item — "Open in Editor": the result set as a read-only text
 * buffer in the preview pane.
 *
 * Three layers: the pure buffer builder, the toolbar button's enable rule, and
 * the wiring through ContentSearchPanel and ExplorerPanel (the buffer really
 * shows, closing it returns to the preview, opening a hit dismisses it).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';

const treeSpy = vi.fn();
const searchFilesSpy = vi.fn();
const searchContentSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchFilesSpy(...args),
        searchContent: (...args: unknown[]) => searchContentSpy(...args),
        reveal: vi.fn(),
    },
}));

// Keep Monaco out of the import graph, as the sibling ExplorerPanel suites do.
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: (props: Record<string, unknown>) => (
        <div data-testid="preview-stub" data-path={String(props.filePath)} />
    ),
}));

import { buildSearchEditorText } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/searchEditorText';
import { ContentSearchToolbar } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchToolbar';
import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import {
    DEFAULT_CONTENT_SEARCH_FILTERS,
    DEFAULT_CONTENT_SEARCH_MODES,
    type TreeEntry,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-open-in-editor';

function match(overrides: Partial<ExplorerContentMatch> = {}): ExplorerContentMatch {
    return {
        path: 'src/app.ts',
        line: 4,
        text: '    const needle = 1;',
        startColumn: 10,
        endColumn: 16,
        before: [],
        after: [],
        ...overrides,
    };
}

function buildText(overrides: Partial<Parameters<typeof buildSearchEditorText>[0]> = {}): string {
    return buildSearchEditorText({
        query: 'needle',
        modes: DEFAULT_CONTENT_SEARCH_MODES,
        filters: DEFAULT_CONTENT_SEARCH_FILTERS,
        matches: [match()],
        truncated: false,
        ...overrides,
    });
}

describe('buildSearchEditorText', () => {
    it('writes a header naming the query and the result counts', () => {
        const text = buildText({
            matches: [match(), match({ line: 9 }), match({ path: 'src/other.ts', line: 2 })],
        });
        expect(text).toContain('# Query: needle');
        expect(text).toContain('# 3 results in 2 files');
    });

    it('uses the singular for one result in one file', () => {
        expect(buildText()).toContain('# 1 result in 1 file');
    });

    it('groups matches under a path line, keeping source indentation', () => {
        const text = buildText({ matches: [match(), match({ line: 12, text: 'needle()' })] });
        expect(text).toContain('src/app.ts:');
        expect(text).toContain('   4      const needle = 1;');
        expect(text).toContain('  12  needle()');
    });

    it('right-aligns line numbers within a file block', () => {
        const text = buildText({ matches: [match({ line: 7 }), match({ line: 1204 })] });
        expect(text).toContain('     7  ');
        expect(text).toContain('  1204  ');
    });

    it('trims trailing whitespace from a match line', () => {
        const text = buildText({ matches: [match({ text: 'needle   ' })] });
        expect(text).toContain('  4  needle\n');
    });

    it('names only the flags that are on, in VS Code order', () => {
        const text = buildText({
            modes: { caseSensitive: true, wholeWord: true, regex: true },
        });
        expect(text).toContain('# Flags: RegExp CaseSensitive WordMatch');
    });

    it('omits the flags line when every mode is off', () => {
        expect(buildText()).not.toContain('# Flags:');
    });

    it('reports the include and exclude globs', () => {
        const text = buildText({
            filters: { include: '*.ts, *.tsx', exclude: 'dist/**', useIgnoreFiles: true },
        });
        expect(text).toContain('# Including: *.ts, *.tsx');
        expect(text).toContain('# Excluding: dist/**');
        // Honouring ignore files is the default, so it goes unsaid.
        expect(text).not.toContain('# Ignore files:');
    });

    it('records the ignore gear only when it is off', () => {
        const text = buildText({
            filters: { ...DEFAULT_CONTENT_SEARCH_FILTERS, useIgnoreFiles: false },
        });
        expect(text).toContain('# Ignore files: off');
    });

    it('records truncation', () => {
        expect(buildText({ truncated: true })).toContain('# Results truncated');
        expect(buildText()).not.toContain('# Results truncated');
    });

    it('still writes a header for an empty result set', () => {
        const text = buildText({ matches: [] });
        expect(text).toContain('# Query: needle');
        expect(text).toContain('# 0 results in 0 files');
    });

    it('ends with a newline', () => {
        expect(buildText().endsWith('\n')).toBe(true);
    });
});

describe('ContentSearchToolbar — Open in Editor', () => {
    afterEach(cleanup);

    const handlers = () => ({
        onRefresh: vi.fn(),
        onClear: vi.fn(),
        onCollapseAll: vi.fn(),
        onToggleResultView: vi.fn(),
        onOpenInEditor: vi.fn(),
        resultView: 'list' as const,
    });

    it('renders the button', () => {
        render(<ContentSearchToolbar enabled hasResults {...handlers()} />);
        const button = screen.getByTestId('content-search-open-in-editor');
        expect(button).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-label', 'Open in editor');
    });

    it('calls its handler on click', () => {
        const props = handlers();
        render(<ContentSearchToolbar enabled hasResults {...props} />);
        screen.getByTestId('content-search-open-in-editor').click();
        expect(props.onOpenInEditor).toHaveBeenCalledTimes(1);
    });

    it('is disabled without results, even with a query', () => {
        render(<ContentSearchToolbar enabled hasResults={false} {...handlers()} />);
        expect(screen.getByTestId('content-search-open-in-editor')).toBeDisabled();
        // The rest of the strip stays usable — only this one needs a result set.
        expect(screen.getByTestId('content-search-refresh')).not.toBeDisabled();
    });

    it('is disabled without a query, results or not', () => {
        render(<ContentSearchToolbar enabled={false} hasResults {...handlers()} />);
        expect(screen.getByTestId('content-search-open-in-editor')).toBeDisabled();
    });
});

describe('ContentSearchPanel — Open in Editor wiring', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        clearExplorerContentResults();
        searchContentSpy.mockReset();
        searchContentSpy.mockResolvedValue({ matches: [match()], truncated: false });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    async function searchFor(query: string): Promise<void> {
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: query } });
        await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS); });
    }

    it('hands the host the buffer text and the query', async () => {
        const onOpenInEditor = vi.fn();
        render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} onOpenInEditor={onOpenInEditor} />);
        await searchFor('needle');

        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });

        expect(onOpenInEditor).toHaveBeenCalledTimes(1);
        const [text, query] = onOpenInEditor.mock.calls[0];
        expect(query).toBe('needle');
        expect(text).toContain('# Query: needle');
        expect(text).toContain('src/app.ts:');
    });

    it('reports the modes and filters the search actually ran with', async () => {
        const onOpenInEditor = vi.fn();
        render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} onOpenInEditor={onOpenInEditor} />);
        await searchFor('needle');
        await act(async () => { screen.getByTestId('content-search-toggle-case').click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });

        expect(onOpenInEditor.mock.calls[0][0]).toContain('# Flags: CaseSensitive');
    });

    it('leaves out a dismissed row — the buffer exports the view', async () => {
        searchContentSpy.mockResolvedValue({
            matches: [match(), match({ path: 'src/other.ts', line: 9, text: 'needle' })],
            truncated: false,
        });
        const onOpenInEditor = vi.fn();
        render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} onOpenInEditor={onOpenInEditor} />);
        await searchFor('needle');

        await act(async () => {
            screen.getByLabelText('Dismiss src/other.ts').click();
        });
        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });

        const text = onOpenInEditor.mock.calls[0][0];
        expect(text).toContain('src/app.ts:');
        expect(text).not.toContain('src/other.ts:');
        expect(text).toContain('# 1 result in 1 file');
    });

    it('disables the button while the query has no results', async () => {
        searchContentSpy.mockResolvedValue({ matches: [], truncated: false });
        render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} onOpenInEditor={vi.fn()} />);
        await searchFor('needle');
        expect(screen.getByTestId('content-search-open-in-editor')).toBeDisabled();
    });

    it('stays disabled for a host that cannot show a buffer', async () => {
        render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
        await searchFor('needle');
        expect(screen.getByTestId('content-search-open-in-editor')).toBeDisabled();
    });
});

describe('ExplorerPanel — the search editor buffer', () => {
    const ROOT_ENTRIES: TreeEntry[] = [
        { name: 'src', type: 'dir', path: 'src', children: [{ name: 'app.ts', type: 'file', path: 'src/app.ts' }] },
    ];

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        location.hash = '';
        clearExplorerTreeCache();
        clearExplorerContentResults();
        treeSpy.mockReset();
        treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
        searchFilesSpy.mockReset();
        searchFilesSpy.mockResolvedValue({ results: [] });
        searchContentSpy.mockReset();
        searchContentSpy.mockResolvedValue({ matches: [match()], truncated: false });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    async function openSearchResults() {
        render(<ExplorerPanel workspaceId={WS} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        await act(async () => { screen.getByTestId('explorer-view-search').click(); });
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS); });
    }

    it('shows the result buffer in the preview pane', async () => {
        await openSearchResults();
        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });

        expect(screen.getByTestId('search-editor-pane')).toBeInTheDocument();
        expect(screen.getByTestId('search-editor-text').textContent).toContain('# Query: needle');
        expect(screen.getByTestId('search-editor-text').textContent).toContain('src/app.ts:');
    });

    it('closes back to an empty preview pane', async () => {
        await openSearchResults();
        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });
        await act(async () => { screen.getByTestId('search-editor-close').click(); });

        expect(screen.queryByTestId('search-editor-pane')).not.toBeInTheDocument();
        expect(screen.queryByTestId('preview-stub')).not.toBeInTheDocument();
    });

    it('steps aside when a match is opened, and comes back on request', async () => {
        await openSearchResults();
        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });

        await act(async () => { screen.getByTestId('content-search-match').click(); });

        expect(screen.queryByTestId('search-editor-pane')).not.toBeInTheDocument();
        expect(screen.getByTestId('preview-stub')).toHaveAttribute('data-path', 'src/app.ts');

        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });
        expect(screen.getByTestId('search-editor-pane')).toBeInTheDocument();
    });

    it('restores the file that was open when the buffer is closed', async () => {
        await openSearchResults();
        await act(async () => { screen.getByTestId('content-search-match').click(); });
        expect(screen.getByTestId('preview-stub')).toBeInTheDocument();

        await act(async () => { screen.getByTestId('content-search-open-in-editor').click(); });
        expect(screen.queryByTestId('preview-stub')).not.toBeInTheDocument();

        await act(async () => { screen.getByTestId('search-editor-close').click(); });
        expect(screen.getByTestId('preview-stub')).toHaveAttribute('data-path', 'src/app.ts');
    });
});
