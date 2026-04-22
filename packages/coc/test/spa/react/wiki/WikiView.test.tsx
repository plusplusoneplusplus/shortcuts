/**
 * Unit tests for WikiView component.
 * WikiView is the top-level router that delegates to WikiList or WikiDetail
 * based on whether a wiki is selected in AppContext.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WikiView } from '../../../../src/server/spa/client/react/wiki/WikiView';

// Mock child components so tests remain focused on routing logic
vi.mock('../../../../src/server/spa/client/react/wiki/WikiList', () => ({
    WikiList: () => <div data-testid="wiki-list">WikiList</div>,
}));
vi.mock('../../../../src/server/spa/client/react/wiki/WikiDetail', () => ({
    WikiDetail: ({ wikiId }: { wikiId: string }) => <div data-testid="wiki-detail" data-wiki-id={wikiId}>WikiDetail</div>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: vi.fn(() => ({ state: { selectedWikiId: null }, dispatch: vi.fn() })),
}));

import { useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';

describe('WikiView — routing', () => {
    it('renders WikiList when no wiki is selected', () => {
        (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
            state: { selectedWikiId: null },
            dispatch: vi.fn(),
        });
        render(<WikiView />);
        expect(screen.getByTestId('wiki-list')).toBeTruthy();
        expect(screen.queryByTestId('wiki-detail')).toBeNull();
    });

    it('renders WikiDetail when a wiki is selected', () => {
        (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
            state: { selectedWikiId: 'w1' },
            dispatch: vi.fn(),
        });
        render(<WikiView />);
        expect(screen.getByTestId('wiki-detail')).toBeTruthy();
        expect(screen.queryByTestId('wiki-list')).toBeNull();
    });

    it('passes the correct wikiId to WikiDetail', () => {
        (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
            state: { selectedWikiId: 'my-wiki-id' },
            dispatch: vi.fn(),
        });
        render(<WikiView />);
        const detail = screen.getByTestId('wiki-detail');
        expect(detail.getAttribute('data-wiki-id')).toBe('my-wiki-id');
    });

    it('switches from WikiDetail to WikiList when selectedWikiId becomes null', () => {
        const { rerender } = render(<WikiView />);

        (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
            state: { selectedWikiId: 'w2' },
            dispatch: vi.fn(),
        });
        rerender(<WikiView />);
        expect(screen.getByTestId('wiki-detail')).toBeTruthy();

        (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
            state: { selectedWikiId: null },
            dispatch: vi.fn(),
        });
        rerender(<WikiView />);
        expect(screen.getByTestId('wiki-list')).toBeTruthy();
    });
});
