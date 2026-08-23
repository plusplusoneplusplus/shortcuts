// @vitest-environment jsdom
/**
 * QuickOpen searches on the server, debounced, and renders only the top matches.
 * The repo path list never crosses the network, and highlighting comes from the
 * indices the server's scorer produced rather than being re-derived here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';

const listFilesSpy = vi.fn();
const searchSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        listFiles: (...args: unknown[]) => listFilesSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
    },
}));

import { QuickOpen, highlightMatches, splitIndices } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/QuickOpen';
import { rankFuzzyMatches } from '../../../../../src/server/shared/fuzzy-file-score';

const FILES = [
    'src/index.ts',
    'src/server/repos/tree-service.ts',
    'src/server/repos/repo-routes.ts',
    'README.md',
    'package.json',
];

/** Stand-in for the server: the same scorer the real endpoint runs. */
function serverSearch(query: string, files: string[] = FILES, limit = 50) {
    return { results: rankFuzzyMatches(query, files, limit), truncated: false };
}

function renderOpen(props?: { onFileSelect?: (p: string) => void; onClose?: () => void }) {
    return render(
        <QuickOpen
            workspaceId="ws-1"
            open
            onClose={props?.onClose ?? (() => {})}
            onFileSelect={props?.onFileSelect ?? (() => {})}
        />,
    );
}

function typeQuery(value: string) {
    fireEvent.change(screen.getByTestId('quick-open-input'), { target: { value } });
}

/** Advance past the keystroke debounce and let the request settle. */
async function flushDebounce() {
    await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
    });
}

beforeEach(() => {
    cleanup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // jsdom does not implement scrollIntoView, which the highlight effect calls.
    Element.prototype.scrollIntoView = vi.fn();
    listFilesSpy.mockReset();
    searchSpy.mockReset();
    searchSpy.mockImplementation((_ws: string, query: string) => Promise.resolve(serverSearch(query)));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('QuickOpen — server-side search', () => {
    it('fetches nothing when the dialog opens', async () => {
        renderOpen();
        await flushDebounce();
        expect(listFilesSpy).not.toHaveBeenCalled();
        expect(searchSpy).not.toHaveBeenCalled();
    });

    it('never requests the whole path list', async () => {
        renderOpen();
        typeQuery('tree');
        await flushDebounce();
        expect(listFilesSpy).not.toHaveBeenCalled();
    });

    it('debounces a burst of keystrokes into a single request', async () => {
        renderOpen();
        for (const value of ['t', 'tr', 'tre', 'tree']) {
            typeQuery(value);
            vi.advanceTimersByTime(10);
        }
        await flushDebounce();

        expect(searchSpy).toHaveBeenCalledTimes(1);
        expect(searchSpy.mock.calls[0][0]).toBe('ws-1');
        expect(searchSpy.mock.calls[0][1]).toBe('tree');
    });

    it('asks the server for at most the rendered result limit', async () => {
        renderOpen();
        typeQuery('tree');
        await flushDebounce();
        expect(searchSpy.mock.calls[0][2]).toMatchObject({ limit: 50 });
    });

    it('renders the server ranking in the order it arrived', async () => {
        renderOpen();
        typeQuery('tree');
        await flushDebounce();
        await waitFor(() =>
            expect(screen.getByTestId('quick-open-item-0')).toHaveTextContent('tree-service.ts'),
        );

        typeQuery('readme');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toHaveTextContent('README.md'));
    });

    it('matches against the full path, not just the file name', async () => {
        renderOpen();
        typeQuery('reposroutes');
        await flushDebounce();
        await waitFor(() =>
            expect(screen.getByTestId('quick-open-item-0')).toHaveTextContent('repo-routes.ts'),
        );
    });

    it('sends a trimmed query and issues no request for a blank one', async () => {
        renderOpen();
        typeQuery('   ');
        await flushDebounce();
        expect(searchSpy).not.toHaveBeenCalled();

        typeQuery('  tree  ');
        await flushDebounce();
        expect(searchSpy.mock.calls[0][1]).toBe('tree');
    });

    it('clears results when the query is emptied again', async () => {
        renderOpen();
        typeQuery('tree');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());

        typeQuery('');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-no-results')).toBeInTheDocument());
    });

    it('shows the no-results message when the server finds nothing', async () => {
        renderOpen();
        typeQuery('zzzzqqqq');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-no-results')).toBeInTheDocument());
    });

    it('selects the highlighted result on Enter', async () => {
        const onFileSelect = vi.fn();
        renderOpen({ onFileSelect });
        typeQuery('tree');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());

        fireEvent.keyDown(screen.getByTestId('quick-open-input'), { key: 'Enter' });
        expect(onFileSelect).toHaveBeenCalledWith('src/server/repos/tree-service.ts');
    });

    it('keeps the previous results rendered while the next search is in flight', async () => {
        renderOpen();
        typeQuery('tree');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());

        let resolveNext: (v: unknown) => void = () => {};
        searchSpy.mockReturnValueOnce(new Promise(resolve => { resolveNext = resolve; }));
        typeQuery('tree-');
        await flushDebounce();

        // No blank "Searching files…" frame between two non-empty result sets.
        expect(screen.queryByText(/Searching files/)).not.toBeInTheDocument();
        expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument();

        await act(async () => {
            resolveNext(serverSearch('tree-'));
        });
    });

    it('shows the loading message only until the first results arrive', async () => {
        let resolveSearch: (v: unknown) => void = () => {};
        searchSpy.mockReturnValueOnce(new Promise(resolve => { resolveSearch = resolve; }));

        renderOpen();
        typeQuery('tree');
        await flushDebounce();
        expect(screen.getByText(/Searching files/)).toBeInTheDocument();

        await act(async () => {
            resolveSearch(serverSearch('tree'));
        });
        await waitFor(() => expect(screen.queryByText(/Searching files/)).not.toBeInTheDocument());
    });

    it('renders no results and no crash when the search fails', async () => {
        searchSpy.mockRejectedValue(new Error('offline'));

        renderOpen();
        typeQuery('tree');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-no-results')).toBeInTheDocument());
    });

    it('renders nothing and searches nothing while closed', async () => {
        render(<QuickOpen workspaceId="ws-1" open={false} onClose={() => {}} onFileSelect={() => {}} />);
        await flushDebounce();
        expect(screen.queryByTestId('quick-open-dialog')).not.toBeInTheDocument();
        expect(searchSpy).not.toHaveBeenCalled();
    });

    it('renders every result the server returned', async () => {
        const many = Array.from({ length: 300 }, (_, i) => `src/file${i}.ts`);
        searchSpy.mockImplementation((_ws: string, query: string) => Promise.resolve(serverSearch(query, many)));

        renderOpen();
        typeQuery('file');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());
        expect(screen.getByTestId('quick-open-results').children.length).toBe(50);
    });

    it('highlights exactly the characters the server scored', async () => {
        searchSpy.mockResolvedValue({
            results: [{ path: 'src/index.ts', score: 42, indices: [4, 6, 8] }],
            truncated: false,
        });

        renderOpen();
        typeQuery('idx');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());

        const marks = screen.getByTestId('quick-open-item-0').querySelectorAll('span.font-semibold');
        expect([...marks].map(m => m.textContent).join('')).toBe('idx');
    });

    it('survives a result without indices', async () => {
        searchSpy.mockResolvedValue({
            results: [{ path: 'src/index.ts', score: 42 }],
            truncated: false,
        });

        renderOpen();
        typeQuery('idx');
        await flushDebounce();
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toHaveTextContent('index.ts'));
    });
});

describe('highlightMatches', () => {
    it('returns the plain string when nothing matched', () => {
        expect(highlightMatches('index.ts', [])).toEqual(['index.ts']);
    });

    it('marks only the given positions', () => {
        const parts = highlightMatches('index.ts', [0, 1]);
        // 'in' marked individually, then the untouched remainder.
        expect(parts).toHaveLength(3);
        expect(parts[2]).toBe('dex.ts');
    });
});

describe('splitIndices', () => {
    it('rebases file-name indices and keeps directory ones', () => {
        // 'src/index.ts' — 's' at 0 is in the directory, 'i' at 4 starts the name.
        expect(splitIndices('src/index.ts', [0, 4, 6])).toEqual({ dir: [0], name: [0, 2] });
    });

    it('puts everything in the name for a path with no directory', () => {
        expect(splitIndices('README.md', [0, 1])).toEqual({ dir: [], name: [0, 1] });
    });

    it('drops the separator position, which belongs to neither segment', () => {
        expect(splitIndices('src/a.ts', [3])).toEqual({ dir: [], name: [] });
    });
});
