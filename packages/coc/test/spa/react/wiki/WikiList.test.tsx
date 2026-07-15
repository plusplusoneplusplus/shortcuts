/**
 * Tests for WikiList component.
 *
 * WikiList uses useWiki (which depends on AppContext) and useApp.
 * We mock both hooks to control the wiki data without real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WikiList } from '../../../../src/server/spa/client/react/wiki/WikiList';

// Mock hooks to avoid real API calls and context requirement
const mockDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/wiki/hooks/useWiki', () => ({
    useWiki: vi.fn(() => ({ wikis: [], reload: vi.fn() })),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: vi.fn(() => ({
        state: { wikis: [], wikiTabState: {} },
        dispatch: mockDispatch,
    })),
}));

import { useWiki } from '../../../../src/server/spa/client/react/wiki/hooks/useWiki';

afterEach(() => {
    vi.clearAllMocks();
});

const makeWiki = (overrides: Record<string, any> = {}) => ({
    id: 'wiki-1',
    name: 'Test Wiki',
    repoPath: '/repo',
    loaded: true,
    status: 'loaded' as const,
    componentCount: 5,
    ...overrides,
});

describe('WikiList', () => {
    it('shows empty state when no wikis', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({ wikis: [], reload: vi.fn() });
        render(<WikiList />);
        expect(document.getElementById('wiki-empty')).toBeTruthy();
        expect(screen.getByText('No wikis yet')).toBeTruthy();
    });

    it('renders a card for each wiki', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({
            wikis: [makeWiki({ id: 'w1', name: 'Wiki 1' }), makeWiki({ id: 'w2', name: 'Wiki 2' })],
            reload: vi.fn(),
        });
        render(<WikiList />);
        expect(screen.getByText('Wiki 1')).toBeTruthy();
        expect(screen.getByText('Wiki 2')).toBeTruthy();
    });

    it('shows "Ready" badge for loaded wikis', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({
            wikis: [makeWiki({ status: 'loaded' })],
            reload: vi.fn(),
        });
        render(<WikiList />);
        expect(screen.getByText('Ready')).toBeTruthy();
    });

    it('shows "Generating" badge for generating wikis', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({
            wikis: [makeWiki({ status: 'generating' })],
            reload: vi.fn(),
        });
        render(<WikiList />);
        expect(screen.getByText('Generating')).toBeTruthy();
    });

    it('shows "Error" badge for error wikis', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({
            wikis: [makeWiki({ status: 'error' })],
            reload: vi.fn(),
        });
        render(<WikiList />);
        expect(screen.getByText('Error')).toBeTruthy();
    });

    it('opens AddWikiDialog when "Add Wiki" button is clicked', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({ wikis: [], reload: vi.fn() });
        render(<WikiList />);
        fireEvent.click(document.getElementById('wiki-list-add-btn')!);
        expect(screen.getByText('Add Wiki')).toBeTruthy();
    });

    it('dispatches SELECT_WIKI when a wiki card is clicked', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({
            wikis: [makeWiki()],
            reload: vi.fn(),
        });
        render(<WikiList />);
        const card = document.querySelector('[data-wiki-id="wiki-1"]') as HTMLElement;
        fireEvent.click(card);
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SELECT_WIKI', wikiId: 'wiki-1' })
        );
    });

    it('renders a refresh button', () => {
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({ wikis: [makeWiki()], reload: vi.fn() });
        render(<WikiList />);
        expect(screen.getByTestId('wiki-list-refresh-btn')).toBeTruthy();
    });

    it('calls reload when refresh button is clicked', () => {
        const reload = vi.fn();
        (useWiki as ReturnType<typeof vi.fn>).mockReturnValue({ wikis: [makeWiki()], reload });
        render(<WikiList />);
        fireEvent.click(screen.getByTestId('wiki-list-refresh-btn'));
        expect(reload).toHaveBeenCalled();
    });
});
