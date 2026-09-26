/**
 * The content-search overlay shell (AC-01 DoD 2).
 *
 * The host is what the pages mount, so these drive it through the real
 * shortcut — open, initial focus, Escape with focus restoration, arrow-key
 * selection, Enter, and a repeat press that must not stack a second dialog.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import {
    ContentSearchOverlay,
    type ContentSearchOverlayMatch,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlay';
import { sourcePreviewLines } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchSourcePreview';
import { ContentSearchOverlayHost } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost';
import { resetContentSearchMemoryForTests } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchStateStore';

beforeEach(() => {
    localStorage.clear();
    resetContentSearchMemoryForTests();
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

/** Fire the real shortcut at `document`, where the host's listener lives. */
function pressShortcut(): void {
    act(() => {
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'F',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
    });
}

function matches(count: number): ContentSearchOverlayMatch[] {
    return Array.from({ length: count }, (_unused, index) => ({
        id: `m${index}`,
        workspaceId: 'coc',
        path: `src/file${index}.ts`,
        line: index + 1,
        preview: `hit ${index}`,
        startColumn: 0,
        endColumn: 3,
    }));
}

describe('ContentSearchOverlayHost', () => {
    it('stays out of the DOM until the shortcut fires, then focuses the query', () => {
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        expect(screen.queryByTestId('content-search-overlay')).toBeNull();

        pressShortcut();

        const dialog = screen.getByTestId('content-search-overlay');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-label')).toBe('Search repository');
        expect(document.activeElement).toBe(screen.getByTestId('content-search-overlay-query'));
    });

    it('names the dialog for a repo-group scope', () => {
        render(<ContentSearchOverlayHost workspaceId="group-my-stack" />);
        pressShortcut();
        expect(screen.getByTestId('content-search-overlay').getAttribute('aria-label')).toBe(
            'Search repository group',
        );
    });

    it('renders nothing at all in an unrelated scope', () => {
        render(<ContentSearchOverlayHost workspaceId="my_work" />);
        pressShortcut();
        expect(screen.queryByTestId('content-search-overlay')).toBeNull();
    });

    it('repeating the shortcut re-focuses the same dialog instead of stacking another', () => {
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();
        const query = screen.getByTestId('content-search-overlay-query') as HTMLInputElement;
        fireEvent.change(query, { target: { value: 'needle' } });
        query.blur();

        pressShortcut();

        expect(screen.getAllByTestId('content-search-overlay')).toHaveLength(1);
        expect(document.activeElement).toBe(query);
        // The previous term is selected, so typing replaces it.
        expect(query.selectionStart).toBe(0);
        expect(query.selectionEnd).toBe('needle'.length);
    });

    it('Escape closes and hands focus back to whatever invoked it', () => {
        render(
            <>
                <button data-testid="invoker">tab</button>
                <ContentSearchOverlayHost workspaceId="coc" />
            </>,
        );
        const invoker = screen.getByTestId('invoker');
        invoker.focus();

        pressShortcut();
        expect(document.activeElement).not.toBe(invoker);

        fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Escape' });

        expect(screen.queryByTestId('content-search-overlay')).toBeNull();
        expect(document.activeElement).toBe(invoker);
    });
});

describe('ContentSearchOverlay keyboard model', () => {
    function renderOverlay(overrides: Partial<React.ComponentProps<typeof ContentSearchOverlay>> = {}) {
        const props = {
            open: true,
            scope: 'repo' as const,
            query: 'needle',
            onQueryChange: vi.fn(),
            onSubmit: vi.fn(),
            onClose: vi.fn(),
            matches: matches(3),
            onOpenMatch: vi.fn(),
            ...overrides,
        };
        render(<ContentSearchOverlay {...props} />);
        return props;
    }

    it('walks matches with the arrow keys and marks the selected option', () => {
        renderOverlay();
        const dialog = screen.getByTestId('content-search-overlay');

        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTestId('content-search-overlay-match-m0').getAttribute('aria-selected')).toBe('true');

        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTestId('content-search-overlay-match-m1').getAttribute('aria-selected')).toBe('true');

        fireEvent.keyDown(dialog, { key: 'ArrowUp' });
        expect(screen.getByTestId('content-search-overlay-match-m0').getAttribute('aria-selected')).toBe('true');
    });

    it('stops at the last match instead of wrapping', () => {
        renderOverlay();
        const dialog = screen.getByTestId('content-search-overlay');
        for (let i = 0; i < 6; i += 1) fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTestId('content-search-overlay-match-m2').getAttribute('aria-selected')).toBe('true');
    });

    it('walking back off the top returns focus to the query', () => {
        renderOverlay();
        const dialog = screen.getByTestId('content-search-overlay');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(screen.getByTestId('content-search-overlay-query'));
        expect(screen.getByTestId('content-search-overlay-match-m0').getAttribute('aria-selected')).toBe('false');
    });

    it('Enter with no selection submits the query', () => {
        const props = renderOverlay();
        fireEvent.keyDown(screen.getByTestId('content-search-overlay-query'), { key: 'Enter' });
        expect(props.onSubmit).toHaveBeenCalledTimes(1);
        expect(props.onOpenMatch).not.toHaveBeenCalled();
    });

    it('Enter on a selected match opens it and never submits', () => {
        const props = renderOverlay();
        const dialog = screen.getByTestId('content-search-overlay');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'Enter' });

        expect(props.onOpenMatch).toHaveBeenCalledTimes(1);
        expect(props.onOpenMatch.mock.calls[0][0].id).toBe('m1');
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('Enter from the query or a search control submits even when a match stays selected', () => {
        const props = renderOverlay();
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
        fireEvent.keyDown(screen.getByTestId('content-search-overlay-query'), { key: 'Enter' });
        fireEvent.keyDown(screen.getByTestId('content-search-overlay-include'), { key: 'Enter' });
        fireEvent.keyDown(screen.getByTestId('content-search-overlay-mode-regex'), { key: 'Enter' });
        expect(props.onSubmit).toHaveBeenCalledTimes(3);
        expect(props.onOpenMatch).not.toHaveBeenCalled();
    });

    it('a click selects without opening, while double-click opens', () => {
        const props = renderOverlay();
        const row = screen.getByTestId('content-search-overlay-match-m2');
        fireEvent.click(row);
        expect(row.getAttribute('aria-selected')).toBe('true');
        expect(props.onOpenMatch).not.toHaveBeenCalled();
        fireEvent.doubleClick(row);
        expect(props.onOpenMatch).toHaveBeenCalledTimes(1);
        expect(props.onOpenMatch.mock.calls[0][0].id).toBe('m2');
    });

    it('highlights exact UTF-16 spans and clamps malformed offsets for each row', () => {
        renderOverlay({
            matches: [
                {
                    id: 'unicode',
                    workspaceId: 'coc',
                    path: 'unicode.ts',
                    line: 1,
                    preview: 'hello 🌍 needle',
                    startColumn: 9,
                    endColumn: 15,
                },
                {
                    id: 'malformed',
                    workspaceId: 'coc',
                    path: 'malformed.ts',
                    line: 2,
                    preview: 'whole row',
                    startColumn: 99,
                    endColumn: 200,
                },
                {
                    id: 'multiline-1',
                    workspaceId: 'coc',
                    path: 'multiline.ts',
                    line: 3,
                    preview: 'start match',
                    startColumn: 6,
                    endColumn: 11,
                },
                {
                    id: 'multiline-2',
                    workspaceId: 'coc',
                    path: 'multiline.ts',
                    line: 4,
                    preview: 'piece end',
                    startColumn: 0,
                    endColumn: 5,
                },
            ],
        });

        expect(screen.getByTestId('content-search-overlay-match-unicode').querySelector('mark')?.textContent)
            .toBe('needle');
        expect(screen.getByTestId('content-search-overlay-match-malformed').textContent)
            .toContain('whole row');
        expect(screen.getByTestId('content-search-overlay-match-malformed').querySelector('mark')?.textContent)
            .toBe('');
        expect(screen.getByTestId('content-search-overlay-match-multiline-1').querySelector('mark')?.textContent)
            .toBe('match');
        expect(screen.getByTestId('content-search-overlay-match-multiline-2').querySelector('mark')?.textContent)
            .toBe('piece');
    });

    it('arrow keys are left alone when there is nothing to select', () => {
        renderOverlay({ matches: [] });
        const dialog = screen.getByTestId('content-search-overlay');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTestId('content-search-overlay-results').children).toHaveLength(0);
    });

    it('clears a selection when a new result set replaces its rows', () => {
        const props = {
            open: true,
            scope: 'repo' as const,
            query: 'needle',
            onQueryChange: vi.fn(),
            onSubmit: vi.fn(),
            onClose: vi.fn(),
            matches: matches(3),
            onOpenMatch: vi.fn(),
        };
        const { rerender } = render(<ContentSearchOverlay {...props} />);
        const dialog = screen.getByTestId('content-search-overlay');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });

        rerender(<ContentSearchOverlay {...props} matches={matches(1)} />);
        fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Enter' });

        expect(props.onOpenMatch).not.toHaveBeenCalled();
        expect(props.onSubmit).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('content-search-overlay-match-m0').getAttribute('aria-selected'))
            .toBe('false');
    });

    it('shows a repository level only in a group scope', () => {
        const groupMatches: ContentSearchOverlayMatch[] = [
            {
                id: 'g0',
                workspaceId: 'api',
                repoLabel: 'api',
                path: 'src/a.ts',
                line: 3,
                preview: 'hit',
                startColumn: 0,
                endColumn: 3,
            },
        ];
        renderOverlay({ scope: 'group', matches: groupMatches });
        expect(screen.getByTestId('content-search-overlay-repo-api').textContent).toContain('api');

        cleanup();
        renderOverlay({ scope: 'repo', matches: groupMatches });
        expect(screen.queryByTestId('content-search-overlay-repo-api')).toBeNull();
        expect(screen.getByTestId('content-search-overlay-file-api src/a.ts')).toBeTruthy();
    });

    it('announces progress through a live status region', () => {
        renderOverlay({ busy: true });
        const status = screen.getByTestId('content-search-overlay-status');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.textContent).toContain('Searching');
    });

    it('keeps filters, selected row, and list scroll while switching preview and back', () => {
        const props = renderOverlay();
        const dialog = screen.getByTestId('content-search-overlay');
        const results = screen.getByTestId('content-search-overlay-results');
        results.scrollTop = 144;
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });

        const body = results.parentElement?.parentElement;
        expect(body?.getAttribute('data-view')).toBe('results');
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(body?.getAttribute('data-view')).toBe('preview');
        expect(screen.getByTestId('content-search-overlay-match-m0').getAttribute('aria-selected'))
            .toBe('true');
        expect(screen.getByTestId('content-search-overlay-query')).toBeTruthy();
        expect(screen.getByTestId('content-search-overlay-include')).toBeTruthy();
        expect(screen.getByTestId('content-search-overlay-preview').textContent).toContain('src/file0.ts');

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(body?.getAttribute('data-view')).toBe('results');
        expect(results.scrollTop).toBe(144);
        expect(props.onOpenMatch).not.toHaveBeenCalled();
    });

    it('restores focus and list position on narrow Back without navigating hidden rows', () => {
        const oldWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 });
        try {
            renderOverlay();
            const dialog = screen.getByTestId('content-search-overlay');
            const list = screen.getByTestId('content-search-overlay-results');
            list.scrollTop = 140;
            fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
            fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back' }));
            fireEvent.keyDown(dialog, { key: 'ArrowDown' });
            expect(screen.getByTestId('content-search-overlay-match-m0').getAttribute('aria-selected'))
                .toBe('true');
            fireEvent.click(screen.getByRole('button', { name: 'Back' }));
            expect(document.activeElement).toBe(screen.getByTestId('content-search-overlay-match-m0'));
            expect(list.scrollTop).toBe(140);
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth });
        }
    });

    it('loads only the selected source, highlights its UTF-16 span, and opens explicitly', async () => {
        const loadPreview = vi.fn(async () => ({
            content: 'before\r\nconst 🌍 needle = 1;\r\nafter',
            encoding: 'utf-8' as const,
            mimeType: 'text/plain',
        }));
        const result = {
            ...matches(1)[0],
            line: 2,
            preview: 'const 🌍 needle = 1;',
            startColumn: 9,
            endColumn: 15,
        };
        const props = renderOverlay({ matches: [result], loadPreview });
        expect(loadPreview).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
        expect(props.onOpenMatch).not.toHaveBeenCalled();
        await screen.findByTestId('content-search-overlay-source');
        expect(loadPreview).toHaveBeenCalledWith(result, expect.any(AbortSignal));
        const source = screen.getByTestId('content-search-overlay-source');
        expect(source.textContent).toContain('before');
        expect(source.textContent).toContain('after');
        expect(source.querySelector('mark')?.textContent).toBe('needle');
        fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
        expect(props.onOpenMatch).toHaveBeenCalledWith(result);
    });

    it('aborts old owner reads and never shows an older preview after a rapid switch', async () => {
        const pending: Array<{
            signal: AbortSignal;
            resolve: (value: { content: string; encoding: 'utf-8'; mimeType: string }) => void;
        }> = [];
        const loadPreview = vi.fn((_match: ContentSearchOverlayMatch, signal: AbortSignal) =>
            new Promise<{ content: string; encoding: 'utf-8'; mimeType: string }>(
                resolve => pending.push({ signal, resolve }),
            ));
        const a = { ...matches(1)[0], id: 'a', routingRef: 'remote:one' };
        const b = { ...a, id: 'b', routingRef: 'remote:two' };
        renderOverlay({ matches: [a, b], loadPreview });
        fireEvent.click(screen.getByTestId('content-search-overlay-match-a'));
        await waitFor(() => expect(pending).toHaveLength(1));
        fireEvent.click(screen.getByTestId('content-search-overlay-match-b'));
        await waitFor(() => expect(pending).toHaveLength(2));
        expect(pending[0].signal.aborted).toBe(true);
        await act(async () => {
            pending[1].resolve({ content: 'hit 0 from newest', encoding: 'utf-8', mimeType: 'text/plain' });
        });
        await act(async () => {
            pending[0].resolve({ content: 'hit 0 from older', encoding: 'utf-8', mimeType: 'text/plain' });
        });
        const source = screen.getByTestId('content-search-overlay-source');
        expect(source.textContent).toContain('newest');
        expect(source.textContent).not.toContain('older');
    });

    it('aborts the selected read when results change or the overlay closes', async () => {
        const signals: AbortSignal[] = [];
        const loadPreview = vi.fn((_match: ContentSearchOverlayMatch, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise<{ content: string; encoding: 'utf-8'; mimeType: string }>(() => {});
        });
        const props = {
            open: true,
            scope: 'repo' as const,
            query: 'hit',
            onQueryChange: vi.fn(),
            onSubmit: vi.fn(),
            onClose: vi.fn(),
            onOpenMatch: vi.fn(),
            matches: matches(1),
            loadPreview,
        };
        const { rerender } = render(<ContentSearchOverlay {...props} />);
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
        await waitFor(() => expect(signals).toHaveLength(1));
        rerender(<ContentSearchOverlay {...props} matches={[...matches(1)]} />);
        expect(signals[0].aborted).toBe(true);
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
        await waitFor(() => expect(signals).toHaveLength(2));
        rerender(<ContentSearchOverlay {...props} open={false} />);
        expect(signals[1].aborted).toBe(true);
    });

    it.each([
        [{ content: 'hit', encoding: 'base64' as const, mimeType: 'application/octet-stream' }, /binary/i],
        [{ content: 'different', encoding: 'utf-8' as const, mimeType: 'text/plain' }, /changed/i],
        [{ content: 'hit\0data', encoding: 'utf-8' as const, mimeType: 'text/plain' }, /binary/i],
    ])('keeps results available when the selected source cannot be previewed', async (blob, reason) => {
        const props = renderOverlay({ loadPreview: vi.fn(async () => blob), matches: matches(1) });
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(reason));
        expect(screen.getByTestId('content-search-overlay-match-m0')).toBeTruthy();
        expect(props.onOpenMatch).not.toHaveBeenCalled();
    });

    it('keeps the list and names a file that disappeared before preview', async () => {
        renderOverlay({
            matches: matches(1),
            loadPreview: vi.fn(async () => {
                throw Object.assign(new Error('Not found'), { status: 404 });
            }),
        });
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
        expect((await screen.findByRole('alert')).textContent).toMatch(/file is no longer available/i);
        expect(screen.getByTestId('content-search-overlay-match-m0')).toBeTruthy();
    });

    it('reports a missing line and renders source as inert text', async () => {
        expect(sourcePreviewLines({
            ...matches(1)[0],
            line: 8,
        }, { content: 'hit 0', encoding: 'utf-8', mimeType: 'text/plain' }))
            .toMatchObject({ status: 'error', message: expect.stringMatching(/changed/) });
        const source = '<img src=x onerror=alert(1)> hit 0';
        renderOverlay({
            matches: [{
                ...matches(1)[0],
                preview: source,
                startColumn: source.indexOf('hit'),
                endColumn: source.length,
            }],
            loadPreview: vi.fn(async () => ({ content: source, encoding: 'utf-8', mimeType: 'text/plain' })),
        });
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m0'));
        const pane = await screen.findByTestId('content-search-overlay-source');
        expect(pane.textContent).toContain('<img src=x');
        expect(pane.querySelector('img')).toBeNull();
    });
});
