// @vitest-environment jsdom
/**
 * Tests for NotesSectionHeader — the collapsible header above one notes
 * sidebar section (a root, or Recents), and for useNotesSectionExpanded, the
 * per-workspace + per-root persistence behind it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { NotesSectionHeader } from '../../../../../../src/server/spa/client/react/features/notes/editor/NotesSectionHeader';
import {
    notesSectionExpandedStorageKey,
    readSectionExpanded,
    useNotesSectionExpanded,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/NotesTreeExpansion';

function renderHeader(overrides: Partial<ComponentProps<typeof NotesSectionHeader>> = {}) {
    const props: ComponentProps<typeof NotesSectionHeader> = {
        label: 'Notes',
        expanded: true,
        onToggle: vi.fn(),
        ...overrides,
    };
    const utils = render(<NotesSectionHeader {...props} />);
    return { ...utils, props };
}

describe('NotesSectionHeader', () => {
    it('renders the label and reports expanded state', () => {
        renderHeader({ label: 'Design Docs', expanded: true });
        const header = screen.getByTestId('notes-section-header');
        expect(header).toHaveAttribute('data-expanded', 'true');
        expect(screen.getByTestId('notes-section-header-toggle')).toHaveTextContent('Design Docs');
        expect(screen.getByTestId('notes-section-header-toggle')).toHaveAttribute('aria-expanded', 'true');
    });

    it('reports collapsed state on the header and the toggle', () => {
        renderHeader({ expanded: false });
        expect(screen.getByTestId('notes-section-header')).toHaveAttribute('data-expanded', 'false');
        expect(screen.getByTestId('notes-section-header-toggle')).toHaveAttribute('aria-expanded', 'false');
    });

    it('calls onToggle when the header row is clicked', () => {
        const { props } = renderHeader();
        fireEvent.click(screen.getByTestId('notes-section-header-toggle'));
        expect(props.onToggle).toHaveBeenCalledTimes(1);
    });

    it('shows a muted count only when one is supplied', () => {
        const { unmount } = renderHeader({ count: 12 });
        expect(screen.getByTestId('notes-section-header-count')).toHaveTextContent('12');
        unmount();
        renderHeader();
        expect(screen.queryByTestId('notes-section-header-count')).toBeNull();
    });

    it('renders a zero count rather than hiding it', () => {
        renderHeader({ count: 0 });
        expect(screen.getByTestId('notes-section-header-count')).toHaveTextContent('0');
    });

    it('shows the protected affordance with its reason as a tooltip', () => {
        renderHeader({ isProtected: true, protectedReason: 'Default managed root cannot be removed' });
        const lock = screen.getByTestId('notes-section-header-protected');
        expect(lock).toHaveAttribute('title', 'Default managed root cannot be removed');
    });

    it('omits the protected affordance for a removable root', () => {
        renderHeader({ isProtected: false });
        expect(screen.queryByTestId('notes-section-header-protected')).toBeNull();
    });

    it('scopes testids to a custom base so stacked sections stay distinguishable', () => {
        renderHeader({ testId: 'notes-section-header-docs', count: 3 });
        expect(screen.getByTestId('notes-section-header-docs')).toBeTruthy();
        expect(screen.getByTestId('notes-section-header-docs-count')).toHaveTextContent('3');
        expect(screen.queryByTestId('notes-section-header')).toBeNull();
    });

    describe('overflow menu', () => {
        const actions = [{ id: 'remove', label: 'Remove root', onSelect: vi.fn(), danger: true }];

        beforeEach(() => {
            actions[0].onSelect = vi.fn();
        });

        it('does not render the ⋯ button when there are no actions', () => {
            renderHeader({ actions: [] });
            expect(screen.queryByTestId('notes-section-header-menu-btn')).toBeNull();
        });

        it('opens the menu and fires the selected action', () => {
            renderHeader({ actions });
            fireEvent.click(screen.getByTestId('notes-section-header-menu-btn'));
            expect(screen.getByTestId('notes-section-header-menu')).toBeTruthy();
            fireEvent.click(screen.getByTestId('notes-section-header-action-remove'));
            expect(actions[0].onSelect).toHaveBeenCalledTimes(1);
            expect(screen.queryByTestId('notes-section-header-menu')).toBeNull();
        });

        it('does not toggle the section when the ⋯ button is clicked', () => {
            const { props } = renderHeader({ actions });
            fireEvent.click(screen.getByTestId('notes-section-header-menu-btn'));
            expect(props.onToggle).not.toHaveBeenCalled();
        });

        it('keeps a disabled action inert', () => {
            const onSelect = vi.fn();
            renderHeader({
                actions: [{ id: 'remove', label: 'Remove root', onSelect, disabled: true, title: 'Protected' }],
            });
            fireEvent.click(screen.getByTestId('notes-section-header-menu-btn'));
            const item = screen.getByTestId('notes-section-header-action-remove');
            expect(item).toBeDisabled();
            expect(item).toHaveAttribute('title', 'Protected');
            fireEvent.click(item);
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('closes the menu on Escape and on an outside click', () => {
            renderHeader({ actions });
            fireEvent.click(screen.getByTestId('notes-section-header-menu-btn'));
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByTestId('notes-section-header-menu')).toBeNull();

            fireEvent.click(screen.getByTestId('notes-section-header-menu-btn'));
            fireEvent.mouseDown(document.body);
            expect(screen.queryByTestId('notes-section-header-menu')).toBeNull();
        });
    });
});

describe('useNotesSectionExpanded', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('keys storage by workspace and root', () => {
        expect(notesSectionExpandedStorageKey('ws-1', 'default'))
            .toBe('coc-notes-section-expanded-ws-1-default');
        expect(notesSectionExpandedStorageKey('ws-1', 'docs'))
            .not.toBe(notesSectionExpandedStorageKey('ws-2', 'docs'));
    });

    it('reads null for an absent or malformed value', () => {
        expect(readSectionExpanded('coc-notes-section-expanded-ws-1-default')).toBeNull();
        localStorage.setItem('coc-notes-section-expanded-ws-1-default', 'yes');
        expect(readSectionExpanded('coc-notes-section-expanded-ws-1-default')).toBeNull();
    });

    it('falls back to the supplied default until the user toggles', () => {
        const { result } = renderHook(() => useNotesSectionExpanded('ws-1', 'docs', false));
        expect(result.current[0]).toBe(false);
        act(() => result.current[1](true));
        expect(result.current[0]).toBe(true);
        expect(localStorage.getItem('coc-notes-section-expanded-ws-1-docs')).toBe('true');
    });

    it('lets a stored false beat a true default', () => {
        localStorage.setItem('coc-notes-section-expanded-ws-1-docs', 'false');
        const { result } = renderHook(() => useNotesSectionExpanded('ws-1', 'docs', true));
        expect(result.current[0]).toBe(false);
    });

    it('re-reads storage when the scope changes', () => {
        localStorage.setItem('coc-notes-section-expanded-ws-1-docs', 'true');
        localStorage.setItem('coc-notes-section-expanded-ws-1-specs', 'false');
        const { result, rerender } = renderHook(
            ({ rootId }: { rootId: string }) => useNotesSectionExpanded('ws-1', rootId, true),
            { initialProps: { rootId: 'docs' } },
        );
        expect(result.current[0]).toBe(true);
        rerender({ rootId: 'specs' });
        expect(result.current[0]).toBe(false);
    });

    it('does not leak state between workspaces', () => {
        localStorage.setItem('coc-notes-section-expanded-ws-1-docs', 'false');
        const { result } = renderHook(() => useNotesSectionExpanded('ws-2', 'docs', true));
        expect(result.current[0]).toBe(true);
    });
});
