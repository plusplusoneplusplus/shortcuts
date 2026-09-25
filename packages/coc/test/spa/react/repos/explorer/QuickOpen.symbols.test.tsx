// @vitest-environment jsdom
/**
 * Go To All's rendering (AC-04, AC-05, AC-07).
 *
 * The fan-out itself is covered in `workspaceSymbols.test.ts`; what is pinned
 * here is what the user sees: symbol rows with their container and location,
 * the prefix filters reinterpreting a live query, and the four distinct states
 * — indexing, unavailable, zero results, results — that must never be confused
 * with one another.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const symbolsState = {
    results: [] as unknown[],
    loading: false,
    streaming: false,
    status: null as string | null,
    indexing: false,
    unavailable: null as { detail: string; recoveryCommand?: string } | null,
};
const useWorkspaceSymbolsSpy = vi.fn(() => symbolsState);

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { listFiles: vi.fn(), searchFiles: vi.fn(async () => ({ results: [] })) },
}));
vi.mock('../../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    searchRepoGroupFiles: vi.fn(async () => ({ results: [], status: 'complete' })),
    getRepoGroup: vi.fn(async () => ({ members: [] })),
}));
vi.mock('../../../../../src/server/spa/client/react/features/language-servers/useWorkspaceSymbols', () => ({
    useWorkspaceSymbols: (...args: unknown[]) => useWorkspaceSymbolsSpy(...(args as [])),
}));

import { QuickOpen } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/QuickOpen';

function symbol(over: Record<string, unknown> = {}) {
    return {
        name: 'findWorkspaceConfig',
        containerName: 'Loader',
        kind: 12,
        path: 'src/config.ts',
        line: 42,
        col: 3,
        definitionId: 'coc-symbols',
        indices: [0, 4, 13],
        ...over,
    };
}

function renderPalette(props: Partial<React.ComponentProps<typeof QuickOpen>> = {}) {
    return render(
        <QuickOpen
            scope={{ kind: 'repo', workspaceId: 'ws-1' }}
            open
            mode="symbols"
            onClose={() => {}}
            onFileSelect={() => {}}
            {...props}
        />,
    );
}

function typeQuery(value: string) {
    fireEvent.change(screen.getByTestId('quick-open-input'), { target: { value } });
}

beforeEach(() => {
    cleanup();
    Object.assign(symbolsState, {
        results: [], loading: false, streaming: false, status: null, indexing: false, unavailable: null,
    });
    useWorkspaceSymbolsSpy.mockClear();
});
afterEach(cleanup);

describe('QuickOpen in symbols mode', () => {
    it('prompts for a query before asking anything', () => {
        renderPalette();
        expect(screen.getByTestId('quick-open-empty-query').textContent).toContain('Type to search symbols');
        expect(useWorkspaceSymbolsSpy.mock.calls.at(-1)?.[0]).toMatchObject({ query: '', open: true });
    });

    it('renders the name, its container and the file location', () => {
        symbolsState.results = [symbol()];
        renderPalette();
        typeQuery('fwc');
        const row = screen.getByTestId('quick-open-item-0');
        expect(row.textContent).toContain('findWorkspaceConfig');
        expect(row.textContent).toContain('Loader');
        expect(screen.getByTestId('quick-open-symbol-path-0').textContent).toBe('src/config.ts:42');
    });

    it('highlights exactly the characters the scorer matched', () => {
        symbolsState.results = [symbol()];
        renderPalette();
        typeQuery('fwc');
        const marked = [...screen.getByTestId('quick-open-item-0').querySelectorAll('span span')]
            .map(node => node.textContent)
            .join('');
        expect(marked).toBe('fWC');
    });

    it('opens the symbol at its line and column on Enter', () => {
        const onSymbolSelect = vi.fn();
        symbolsState.results = [symbol()];
        renderPalette({ onSymbolSelect });
        typeQuery('fwc');
        fireEvent.keyDown(screen.getByTestId('quick-open-input'), { key: 'Enter' });
        expect(onSymbolSelect).toHaveBeenCalledWith(expect.objectContaining({ line: 42, col: 3 }));
    });

    it('names the prefix grammar before anything is typed and until a filter takes over', () => {
        symbolsState.results = [symbol({ name: 'Loader', kind: 5 })];
        renderPalette();
        for (const hint of ['f', 't', 'm', ':42']) {
            expect(screen.getByTestId('quick-open-prefix-hints').textContent).toContain(hint);
            expect(screen.getByTestId('quick-open-footer-hints').textContent).toContain(hint);
        }

        typeQuery('t lo');
        expect(screen.queryByTestId('quick-open-footer-hints')).toBeNull();
        expect(document.body.textContent).toContain('Types ·');
    });

    it('`t ` keeps types, `m ` keeps members, and the footer names the filter', () => {
        symbolsState.results = [symbol({ name: 'Loader', kind: 5 }), symbol({ name: 'load', kind: 12 })];
        renderPalette();

        typeQuery('t lo');
        expect(screen.getByTestId('quick-open-item-0').textContent).toContain('Loader');
        expect(screen.queryByTestId('quick-open-item-1')).toBeNull();
        expect(document.body.textContent).toContain('Types ·');

        typeQuery('m lo');
        expect(screen.getByTestId('quick-open-item-0').textContent).toContain('load');
        expect(screen.queryByTestId('quick-open-item-1')).toBeNull();
        expect(document.body.textContent).toContain('Members ·');
    });

    it('`f ` hands the query back to the file search', () => {
        renderPalette();
        typeQuery('f quick');
        expect(useWorkspaceSymbolsSpy.mock.calls.at(-1)?.[0]).toMatchObject({ open: false });
        expect(screen.getByTestId('quick-open-input').getAttribute('placeholder')).toContain('files');
    });

    it('`:N` offers the jump, and says so plainly with no editor to jump in', () => {
        const onLineSelect = vi.fn();
        const onClose = vi.fn();
        const { rerender } = renderPalette({ onLineSelect, onClose });
        typeQuery(':120');
        expect(screen.getByTestId('quick-open-line-target').textContent).toContain('line 120');
        fireEvent.keyDown(screen.getByTestId('quick-open-input'), { key: 'Enter' });
        expect(onLineSelect).toHaveBeenCalledWith(120);
        expect(onClose).toHaveBeenCalled();

        rerender(
            <QuickOpen scope={{ kind: 'repo', workspaceId: 'ws-1' }} open mode="symbols"
                onClose={() => {}} onFileSelect={() => {}} />,
        );
        typeQuery(':120');
        expect(screen.getByTestId('quick-open-line-target').textContent).toContain('Open a file first');
    });

    it('says "Indexing…" rather than "no symbols found" while the index is building', () => {
        symbolsState.indexing = true;
        renderPalette();
        typeQuery('fwc');
        expect(screen.getByTestId('quick-open-indexing').textContent).toContain('Indexing');
        expect(screen.queryByTestId('quick-open-no-results')).toBeNull();
    });

    it('shows the host recovery command rather than an empty list', () => {
        symbolsState.unavailable = {
            detail: 'The symbol index binary is missing.',
            recoveryCommand: 'npm run build:native -w packages/coc-native',
        };
        renderPalette();
        typeQuery('fwc');
        const box = screen.getByTestId('quick-open-unavailable');
        expect(box.textContent).toContain('The symbol index binary is missing.');
        expect(box.textContent).toContain('npm run build:native -w packages/coc-native');
    });

    it('zero results and indexing are distinct renderings', () => {
        renderPalette();
        typeQuery('fwc');
        expect(screen.getByTestId('quick-open-no-results').textContent).toBe('No symbols found');
        expect(screen.queryByTestId('quick-open-indexing')).toBeNull();
    });

    it('notes a partial group answer and a repo still indexing beside the results', () => {
        symbolsState.results = [symbol({ repoName: 'core' })];
        symbolsState.status = 'partial';
        symbolsState.indexing = true;
        renderPalette({
            scope: { kind: 'repo-group', groupId: 'g', groupName: 'Everything', liveRepoCount: 3 },
        });
        typeQuery('fwc');
        expect(screen.getByTestId('quick-open-partial')).toBeTruthy();
        expect(screen.getByTestId('quick-open-indexing-note').textContent).toContain('still indexing');
        expect(screen.getByTestId('quick-open-repo-0').textContent).toBe('core');
    });
});
