/**
 * The content-search overlay shell (AC-01 DoD 2).
 *
 * The host is what the pages mount, so these drive it through the real
 * shortcut — open, initial focus, Escape with focus restoration, arrow-key
 * selection, Enter, and a repeat press that must not stack a second dialog.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
    ContentSearchOverlay,
    type ContentSearchOverlayMatch,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlay';
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

    it('a click opens the same match a keyboard selection would', () => {
        const props = renderOverlay();
        fireEvent.click(screen.getByTestId('content-search-overlay-match-m2'));
        expect(props.onOpenMatch).toHaveBeenCalledTimes(1);
        expect(props.onOpenMatch.mock.calls[0][0].id).toBe('m2');
    });

    it('arrow keys are left alone when there is nothing to select', () => {
        renderOverlay({ matches: [] });
        const dialog = screen.getByTestId('content-search-overlay');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTestId('content-search-overlay-results').children).toHaveLength(0);
    });

    it('clamps a selection that a smaller result set left dangling', () => {
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

        expect(props.onOpenMatch.mock.calls[0][0].id).toBe('m0');
    });

    it('shows a repository level only in a group scope', () => {
        const groupMatches: ContentSearchOverlayMatch[] = [
            { id: 'g0', workspaceId: 'api', repoLabel: 'api', path: 'src/a.ts', line: 3, preview: 'hit' },
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
});
