import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchContent = vi.fn();
vi.mock(
    '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi',
    () => ({ explorerApi: { searchContent: (...args: unknown[]) => searchContent(...args) } }),
);

import { ContentSearchOverlayHost } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost';
import {
    contentSearchControlsStorageKey,
    contentSearchScopeKey,
    resetContentSearchMemoryForTests,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchStateStore';

function pressShortcut(): void {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'F',
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        }));
    });
}

function setQuery(value: string): void {
    fireEvent.change(screen.getByTestId('content-search-overlay-query'), {
        target: { value },
    });
}

function submit(): void {
    fireEvent.keyDown(screen.getByTestId('content-search-overlay-query'), { key: 'Enter' });
}

function serverMatch(path: string, text: string) {
    return {
        path,
        line: 4,
        text,
        startColumn: 0,
        endColumn: text.length,
        before: [],
        after: [],
    };
}

beforeEach(() => {
    localStorage.clear();
    resetContentSearchMemoryForTests();
    searchContent.mockReset();
    searchContent.mockResolvedValue({
        matches: [serverMatch('src/result.ts', 'needle')],
        truncated: false,
    });
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

describe('tracked content-search scope state', () => {
    it('restores controls and current results when the same overlay is reopened', async () => {
        render(<ContentSearchOverlayHost workspaceId="repo" routingRef="clone-a" />);
        pressShortcut();
        setQuery('needle');
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-caseSensitive'));
        submit();
        await screen.findByText('src/result.ts');

        fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Escape' });
        pressShortcut();

        expect((screen.getByTestId('content-search-overlay-query') as HTMLInputElement).value)
            .toBe('needle');
        expect(screen.getByTestId('content-search-overlay-mode-caseSensitive')
            .getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByText('src/result.ts')).toBeTruthy();
        expect(searchContent).toHaveBeenCalledTimes(1);
    });

    it('isolates controls, results, and owner routes between same-id clones', async () => {
        searchContent.mockImplementation((_workspaceId, query, _options, routingRef) =>
            Promise.resolve({
                matches: [serverMatch(`src/${routingRef}.ts`, String(query))],
                truncated: false,
            }),
        );
        const { rerender } = render(
            <ContentSearchOverlayHost workspaceId="shared" routingRef="clone-a" />,
        );
        pressShortcut();
        setQuery('alpha');
        submit();
        await screen.findByText('src/clone-a.ts');

        rerender(<ContentSearchOverlayHost workspaceId="shared" routingRef="clone-b" />);
        expect((screen.getByTestId('content-search-overlay-query') as HTMLInputElement).value)
            .toBe('');
        expect(screen.queryByText('src/clone-a.ts')).toBeNull();
        setQuery('beta');
        await waitFor(() => expect(
            (screen.getByTestId('content-search-overlay-query') as HTMLInputElement).value,
        ).toBe('beta'));
        submit();
        await screen.findByText('src/clone-b.ts');

        rerender(<ContentSearchOverlayHost workspaceId="shared" routingRef="clone-a" />);
        await waitFor(() => expect(
            (screen.getByTestId('content-search-overlay-query') as HTMLInputElement).value,
        ).toBe('alpha'));
        expect(screen.getByText('src/clone-a.ts')).toBeTruthy();
        expect(screen.queryByText('src/clone-b.ts')).toBeNull();
        expect(searchContent.mock.calls.map(call => call[3])).toEqual(['clone-a', 'clone-b']);
    });

    it('restores persisted controls after reload without results or an automatic request', async () => {
        const view = render(
            <ContentSearchOverlayHost workspaceId="repo" routingRef="clone-a" />,
        );
        pressShortcut();
        setQuery('remember me');
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-caseSensitive'));
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-wholeWord'));
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-regex'));
        fireEvent.change(screen.getByTestId('content-search-overlay-include'), {
            target: { value: 'src/**' },
        });
        fireEvent.change(screen.getByTestId('content-search-overlay-exclude'), {
            target: { value: 'dist/**' },
        });
        fireEvent.click(screen.getByTestId('content-search-overlay-untracked'));
        submit();
        await screen.findByText('src/result.ts');
        expect(searchContent).toHaveBeenCalledTimes(1);

        view.unmount();
        resetContentSearchMemoryForTests();
        render(<ContentSearchOverlayHost workspaceId="repo" routingRef="clone-a" />);
        pressShortcut();

        expect((screen.getByTestId('content-search-overlay-query') as HTMLInputElement).value)
            .toBe('remember me');
        expect((screen.getByTestId('content-search-overlay-untracked') as HTMLInputElement).checked)
            .toBe(true);
        expect(screen.getByTestId('content-search-overlay-mode-caseSensitive')
            .getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('content-search-overlay-mode-wholeWord')
            .getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('content-search-overlay-mode-regex')
            .getAttribute('aria-pressed')).toBe('true');
        expect((screen.getByTestId('content-search-overlay-include') as HTMLInputElement).value)
            .toBe('src/**');
        expect((screen.getByTestId('content-search-overlay-exclude') as HTMLInputElement).value)
            .toBe('dist/**');
        expect(screen.queryByText('src/result.ts')).toBeNull();
        expect(screen.getByTestId('content-search-overlay-status').textContent)
            .toMatch(/press Enter/i);
        expect(searchContent).toHaveBeenCalledTimes(1);
        expect(Array.from({ length: localStorage.length }, (_, index) =>
            localStorage.getItem(localStorage.key(index) ?? '')).join('\n'))
            .not.toContain('src/result.ts');
    });

    it('cancels a search on scope change and restores the last settled results', async () => {
        let keepPending!: () => void;
        searchContent
            .mockResolvedValueOnce({
                matches: [serverMatch('src/settled.ts', 'first')],
                truncated: false,
            })
            .mockImplementationOnce(() => new Promise(resolve => {
                keepPending = () => resolve({ matches: [], truncated: false });
            }));
        const { rerender } = render(
            <ContentSearchOverlayHost workspaceId="shared" routingRef="clone-a" />,
        );
        pressShortcut();
        setQuery('first');
        submit();
        await screen.findByText('src/settled.ts');

        setQuery('refresh');
        submit();
        const pendingSignal = searchContent.mock.calls[1][2].signal as AbortSignal;
        rerender(<ContentSearchOverlayHost workspaceId="shared" routingRef="clone-b" />);
        expect(pendingSignal.aborted).toBe(true);

        rerender(<ContentSearchOverlayHost workspaceId="shared" routingRef="clone-a" />);
        await screen.findByText('src/settled.ts');
        expect(screen.getByTestId('content-search-overlay-status').textContent)
            .toBe('1 result in 1 file');
        keepPending();
    });

    it('uses different persisted keys for repository, group, and clone scopes', () => {
        const local = contentSearchScopeKey({ workspaceId: 'same', scope: 'repo' });
        const remote = contentSearchScopeKey({
            workspaceId: 'same',
            scope: 'repo',
            routingRef: 'clone-remote',
        });
        const group = contentSearchScopeKey({ workspaceId: 'same', scope: 'group' });

        expect(new Set([
            contentSearchControlsStorageKey(local),
            contentSearchControlsStorageKey(remote),
            contentSearchControlsStorageKey(group),
        ]).size).toBe(3);
    });
});
