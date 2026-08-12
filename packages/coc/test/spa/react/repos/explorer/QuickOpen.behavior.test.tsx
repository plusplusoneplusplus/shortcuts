// @vitest-environment jsdom
/**
 * QuickOpen fetches the repo path list once per dialog open and fuzzy-matches in
 * the browser, so keystrokes cost no network round-trip and the list never blanks
 * out mid-typing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const listFilesSpy = vi.fn();
const searchSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        listFiles: (...args: unknown[]) => listFilesSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
    },
}));

import { QuickOpen } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/QuickOpen';

const FILES = [
    'src/index.ts',
    'src/server/repos/tree-service.ts',
    'src/server/repos/repo-routes.ts',
    'README.md',
    'package.json',
];

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

async function typeQuery(value: string) {
    fireEvent.change(screen.getByTestId('quick-open-input'), { target: { value } });
}

beforeEach(() => {
    cleanup();
    // jsdom does not implement scrollIntoView, which the highlight effect calls.
    Element.prototype.scrollIntoView = vi.fn();
    listFilesSpy.mockReset();
    listFilesSpy.mockResolvedValue({ files: FILES, truncated: false });
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [], truncated: false });
});

describe('QuickOpen — client-side matching', () => {
    it('fetches the file list once when the dialog opens', async () => {
        renderOpen();
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));
        expect(listFilesSpy.mock.calls[0][0]).toBe('ws-1');
    });

    it('does not issue a request per keystroke', async () => {
        renderOpen();
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));

        for (const value of ['t', 'tr', 'tre', 'tree']) {
            await typeQuery(value);
        }

        expect(listFilesSpy).toHaveBeenCalledTimes(1);
        expect(searchSpy).not.toHaveBeenCalled();
    });

    it('filters results locally as the query changes', async () => {
        renderOpen();
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));

        await typeQuery('tree');
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toHaveTextContent('tree-service.ts'));

        await typeQuery('readme');
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toHaveTextContent('README.md'));
    });

    it('matches against the full path, not just the file name', async () => {
        renderOpen();
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));

        await typeQuery('reposroutes');
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toHaveTextContent('repo-routes.ts'));
    });

    it('shows the no-results message for a query that matches nothing', async () => {
        renderOpen();
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));

        await typeQuery('zzzzqqqq');
        await waitFor(() => expect(screen.getByTestId('quick-open-no-results')).toBeInTheDocument());
    });

    it('selects the highlighted result on Enter', async () => {
        const onFileSelect = vi.fn();
        renderOpen({ onFileSelect });
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));

        await typeQuery('tree');
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());
        fireEvent.keyDown(screen.getByTestId('quick-open-input'), { key: 'Enter' });

        expect(onFileSelect).toHaveBeenCalledWith('src/server/repos/tree-service.ts');
    });

    it('keeps results rendered while a query changes (never blanks to loading)', async () => {
        renderOpen();
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));

        await typeQuery('tree');
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());

        await typeQuery('tree-');
        // No intermediate "Loading files…" frame — matching is synchronous.
        expect(screen.queryByText(/Loading files/)).not.toBeInTheDocument();
        expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument();
    });

    it('shows the loading message only until the first list arrives', async () => {
        let resolveList: (v: unknown) => void = () => {};
        listFilesSpy.mockReturnValue(new Promise(resolve => { resolveList = resolve; }));

        renderOpen();
        expect(screen.getByText(/Loading files/)).toBeInTheDocument();

        resolveList({ files: FILES, truncated: false });
        await waitFor(() => expect(screen.queryByText(/Loading files/)).not.toBeInTheDocument());
    });

    it('renders no results and no crash when the fetch fails', async () => {
        listFilesSpy.mockRejectedValue(new Error('offline'));

        renderOpen();
        await waitFor(() => expect(screen.getByTestId('quick-open-no-results')).toBeInTheDocument());

        await typeQuery('tree');
        await waitFor(() => expect(screen.getByTestId('quick-open-no-results')).toBeInTheDocument());
    });

    it('renders nothing and fetches nothing while closed', () => {
        render(<QuickOpen workspaceId="ws-1" open={false} onClose={() => {}} onFileSelect={() => {}} />);
        expect(screen.queryByTestId('quick-open-dialog')).not.toBeInTheDocument();
        expect(listFilesSpy).not.toHaveBeenCalled();
    });

    it('caps the rendered result count', async () => {
        const many = Array.from({ length: 300 }, (_, i) => `src/file${i}.ts`);
        listFilesSpy.mockResolvedValue({ files: many, truncated: false });

        renderOpen();
        await waitFor(() => expect(listFilesSpy).toHaveBeenCalledTimes(1));

        await typeQuery('file');
        await waitFor(() => expect(screen.getByTestId('quick-open-item-0')).toBeInTheDocument());
        expect(screen.getByTestId('quick-open-results').children.length).toBe(50);
    });
});
