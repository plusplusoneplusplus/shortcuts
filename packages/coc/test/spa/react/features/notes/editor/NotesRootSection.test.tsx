// @vitest-environment jsdom
/**
 * Tests for NotesRootSection — one notes root rendered as a (optionally
 * headed) section: the tree plus its loading / error / empty / no-search-match
 * states, extracted out of NotesSidebar's inline tree area.
 *
 * The bare (headerless) mode is the AC-07 regression guard: a single-root
 * sidebar must keep exactly today's testids and markup.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotesRootSection } from '../../../../../../src/server/spa/client/react/features/notes/editor/NotesRootSection';
import type { NoteTreeNode } from '../../../../../../src/server/spa/client/react/features/notes/notesApi';

const TREE: NoteTreeNode[] = [
    { name: 'Alpha', path: 'Alpha', type: 'page' },
    { name: 'Beta', path: 'Beta', type: 'page' },
];

function baseTreeProps(): ComponentProps<typeof NotesRootSection>['treeProps'] {
    return {
        selectedPath: null,
        expandedPaths: new Set<string>(),
        onToggleExpand: vi.fn(),
        onSelectPage: vi.fn(),
        onContextMenu: vi.fn(),
    };
}

function renderSection(overrides: Partial<ComponentProps<typeof NotesRootSection>> = {}) {
    const props: ComponentProps<typeof NotesRootSection> = {
        loading: false,
        error: null,
        tree: TREE,
        searchQuery: '',
        filter: null,
        treeProps: baseTreeProps(),
        ...overrides,
    };
    return { ...render(<NotesRootSection {...props} />), props };
}

describe('NotesRootSection — bare mode (single root, AC-07)', () => {
    it('renders the tree with no section header', () => {
        renderSection();
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.queryByTestId('notes-section-header')).toBeNull();
        expect(screen.queryByTestId('notes-root-section')).toBeNull();
    });

    it('shows the loading state under the bare testid', () => {
        renderSection({ loading: true, tree: null });
        expect(screen.getByTestId('notes-loading')).toBeInTheDocument();
        expect(screen.queryByText('Alpha')).toBeNull();
    });

    it('shows the error state instead of the tree', () => {
        renderSection({ error: 'boom', tree: TREE });
        expect(screen.getByTestId('notes-error')).toHaveTextContent('boom');
        expect(screen.queryByText('Alpha')).toBeNull();
    });

    it('error only renders once loading has finished', () => {
        renderSection({ loading: true, error: 'boom', tree: null });
        expect(screen.getByTestId('notes-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('notes-error')).toBeNull();
    });

    it('shows the empty state for an empty tree', () => {
        renderSection({ tree: [] });
        expect(screen.getByTestId('notes-empty')).toHaveTextContent('No notebooks yet');
    });

    it('filters rows to the search filter and keeps matches visible', () => {
        renderSection({ searchQuery: 'alp', filter: { visible: new Set(['Alpha']) } });
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.queryByText('Beta')).toBeNull();
        expect(screen.queryByTestId('notes-search-empty')).toBeNull();
    });

    it('shows the no-match state when the filter matches nothing', () => {
        renderSection({ searchQuery: '  zzz  ', filter: { visible: new Set<string>() } });
        expect(screen.getByTestId('notes-search-empty')).toHaveTextContent('No notes match “zzz”');
    });
});

describe('NotesRootSection — headed mode (stacked sections, AC-01/AC-02)', () => {
    function headerProps(overrides: Partial<NonNullable<ComponentProps<typeof NotesRootSection>['header']>> = {}) {
        return { label: 'Design Docs', expanded: true, onToggle: vi.fn(), ...overrides };
    }

    it('renders a header with the root label above the tree', () => {
        renderSection({ header: headerProps({ count: 2 }) });
        expect(screen.getByTestId('notes-section-header-toggle')).toHaveTextContent('Design Docs');
        expect(screen.getByTestId('notes-section-header-count')).toHaveTextContent('2');
        expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    it('hides the body while collapsed and reports it on the section', () => {
        renderSection({ header: headerProps({ expanded: false }) });
        expect(screen.getByTestId('notes-root-section')).toHaveAttribute('data-expanded', 'false');
        expect(screen.queryByText('Alpha')).toBeNull();
    });

    it('forwards the header toggle', () => {
        const onToggle = vi.fn();
        renderSection({ header: headerProps({ onToggle }) });
        fireEvent.click(screen.getByTestId('notes-section-header-toggle'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('suffixes every owned testid so stacked sections stay addressable', () => {
        renderSection({
            testIdSuffix: 'root-b',
            header: headerProps(),
            loading: true,
            tree: null,
        });
        expect(screen.getByTestId('notes-root-section-root-b')).toBeInTheDocument();
        expect(screen.getByTestId('notes-section-header-root-b')).toBeInTheDocument();
        expect(screen.getByTestId('notes-loading-root-b')).toBeInTheDocument();
        // The bare names must NOT leak once a suffix is in play.
        expect(screen.queryByTestId('notes-loading')).toBeNull();
        expect(screen.queryByTestId('notes-section-header')).toBeNull();
    });

    it('keeps its header visible when search matches nothing (AC-06)', () => {
        renderSection({
            testIdSuffix: 'root-b',
            header: headerProps(),
            searchQuery: 'zzz',
            filter: { visible: new Set<string>() },
        });
        expect(screen.getByTestId('notes-section-header-root-b')).toBeInTheDocument();
        expect(screen.getByTestId('notes-search-empty-root-b')).toBeInTheDocument();
    });

    it('passes protected / default indicators through to the header', () => {
        renderSection({
            header: headerProps({ isProtected: true, protectedReason: 'Managed root' }),
        });
        expect(screen.getByTestId('notes-section-header-protected')).toHaveAttribute('title', 'Managed root');
    });

    it('renders overflow actions on the header', () => {
        const onSelect = vi.fn();
        renderSection({
            header: headerProps({ actions: [{ id: 'remove-root', label: 'Remove root', onSelect }] }),
        });
        fireEvent.click(screen.getByTestId('notes-section-header-menu-btn'));
        fireEvent.click(screen.getByTestId('notes-section-header-action-remove-root'));
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});
