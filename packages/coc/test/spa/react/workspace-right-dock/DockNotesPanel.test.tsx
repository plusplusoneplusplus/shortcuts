/**
 * DockNotesPanel — the Notes view inside the workspace right dock.
 *
 * The notes API is mocked (no server), and the shared markdown-preview hook is
 * mocked to echo its input so preview assertions stay about *what* is previewed
 * rather than about the renderer's HTML.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getTree = vi.fn();
const getContent = vi.fn();
const createNode = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getTree: (...args: any[]) => getTree(...args),
        getContent: (...args: any[]) => getContent(...args),
        createNode: (...args: any[]) => createNode(...args),
    },
}));

// Echo the markdown through so the test asserts the previewed note content, not
// the shared renderer's HTML (covered by its own tests).
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content, loading }: { content: string; loading?: boolean }) => ({
        html: loading ? '' : content,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

import { DockNotesPanel } from '../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel';
import { COMPOSER_INSERT_EVENT } from '../../../../src/server/spa/client/react/features/chat/composerInsert';

const TREE = [
    {
        name: 'Plans',
        path: 'Plans',
        type: 'notebook',
        children: [
            { name: 'MLA cache.md', path: 'Plans/MLA cache.md', type: 'page', lastModifiedAt: '2026-08-25T10:00:00.000Z' },
        ],
    },
    { name: 'batching.md', path: 'batching.md', type: 'page', lastModifiedAt: '2026-08-20T10:00:00.000Z' },
];

function itemPaths(): string[] {
    return screen.queryAllByTestId('workspace-dock-notes-item').map(el => el.getAttribute('data-note-path')!);
}

describe('DockNotesPanel', () => {
    beforeEach(() => {
        getTree.mockReset().mockResolvedValue({ tree: TREE, notesRoot: '/notes' });
        getContent.mockReset().mockImplementation((_ws: string, notePath: string) =>
            Promise.resolve({ content: `body of ${notePath}`, path: notePath, mtime: 1 }));
        createNode.mockReset().mockResolvedValue({ path: 'Untitled.md' });
        location.hash = '';
    });

    afterEach(() => {
        cleanup();
    });

    it('lists the workspace notes newest-first and auto-selects the first one', async () => {
        render(<DockNotesPanel workspaceId="ws1" />);

        await waitFor(() => expect(itemPaths()).toEqual(['Plans/MLA cache.md', 'batching.md']));
        expect(getTree).toHaveBeenCalledWith('ws1');
        // Titles drop the .md; the folder line only shows for nested notes.
        expect(screen.getByText('MLA cache')).toBeTruthy();
        expect(screen.getByText('Plans')).toBeTruthy();
        await waitFor(() =>
            expect(screen.getByTestId('workspace-dock-notes-preview').textContent)
                .toBe('body of Plans/MLA cache.md'));
    });

    it('previews the note the user selects', async () => {
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() => expect(itemPaths()).toHaveLength(2));

        fireEvent.click(screen.getAllByTestId('workspace-dock-notes-item')[1]);

        await waitFor(() =>
            expect(screen.getByTestId('workspace-dock-notes-preview').textContent).toBe('body of batching.md'));
        expect(screen.getAllByTestId('workspace-dock-notes-item')[1].getAttribute('aria-selected')).toBe('true');
    });

    it('filters the list by the search box and re-selects a still-visible note', async () => {
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() => expect(itemPaths()).toHaveLength(2));

        fireEvent.change(screen.getByTestId('workspace-dock-notes-search'), { target: { value: 'batch' } });

        await waitFor(() => expect(itemPaths()).toEqual(['batching.md']));
        // The previously selected note was filtered out → selection follows the list.
        await waitFor(() =>
            expect(screen.getByTestId('workspace-dock-notes-preview').textContent).toBe('body of batching.md'));
    });

    it('shows a search-specific empty state', async () => {
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() => expect(itemPaths()).toHaveLength(2));

        fireEvent.change(screen.getByTestId('workspace-dock-notes-search'), { target: { value: 'zzz' } });

        expect(screen.getByTestId('workspace-dock-notes-empty').textContent).toContain('No notes match');
    });

    it('creates a non-colliding untitled note, selects it, and reloads the list', async () => {
        getTree.mockResolvedValueOnce({ tree: [{ name: 'Untitled.md', path: 'Untitled.md', type: 'page' }], notesRoot: '/n' });
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() => expect(itemPaths()).toEqual(['Untitled.md']));

        getTree.mockResolvedValue({
            tree: [
                { name: 'Untitled.md', path: 'Untitled.md', type: 'page' },
                { name: 'Untitled 2.md', path: 'Untitled 2.md', type: 'page' },
            ],
            notesRoot: '/n',
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('workspace-dock-notes-new'));
        });

        expect(createNode).toHaveBeenCalledWith('ws1', 'Untitled 2.md', 'page');
        // Neither untitled note has an mtime, so they fall back to path order.
        await waitFor(() => expect(itemPaths()).toEqual(['Untitled 2.md', 'Untitled.md']));
        await waitFor(() =>
            expect(screen.getByTestId('workspace-dock-notes-preview').textContent).toBe('body of Untitled 2.md'));
    });

    it('dispatches a notes-root-relative reference for "Insert into chat"', async () => {
        const seen: any[] = [];
        const handler = (e: Event) => seen.push((e as CustomEvent).detail);
        window.addEventListener(COMPOSER_INSERT_EVENT, handler);
        try {
            render(<DockNotesPanel workspaceId="ws1" />);
            await waitFor(() => expect(itemPaths()).toHaveLength(2));

            fireEvent.click(screen.getByTestId('workspace-dock-notes-insert-into-chat'));

            expect(seen).toHaveLength(1);
            expect(seen[0].workspaceId).toBe('ws1');
            expect(seen[0].text).toContain('<note_reference path="Plans/MLA cache.md">');
        } finally {
            window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
        }
    });

    it('deep-links the selected note into the full Notes tab', async () => {
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() => expect(itemPaths()).toHaveLength(2));

        fireEvent.click(screen.getByTestId('workspace-dock-notes-open-tab'));

        // buildNoteHash encodes each path segment, keeping the `/` separators readable.
        expect(location.hash).toBe('#repos/ws1/notes/Plans/MLA%20cache.md');
    });

    it('offers no note actions while nothing is selected', async () => {
        getTree.mockResolvedValue({ tree: [], notesRoot: '/n' });
        render(<DockNotesPanel workspaceId="ws1" />);

        await waitFor(() => expect(screen.getByTestId('workspace-dock-notes-empty').textContent).toContain('No notes yet'));
        expect((screen.getByTestId('workspace-dock-notes-insert-into-chat') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('workspace-dock-notes-open-tab') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByTestId('workspace-dock-notes-preview')).toBeNull();
    });

    it('surfaces a tree load failure instead of rendering an empty list', async () => {
        getTree.mockRejectedValue(new Error('boom'));
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() => expect(screen.getByTestId('workspace-dock-notes-error').textContent).toBe('boom'));
    });

    it('surfaces a note load failure in the preview area', async () => {
        getContent.mockRejectedValue(new Error('no read'));
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() =>
            expect(screen.getByTestId('workspace-dock-notes-preview-error').textContent).toBe('no read'));
    });

    it('refreshes when the server reports a note change for this workspace only', async () => {
        render(<DockNotesPanel workspaceId="ws1" />);
        await waitFor(() => expect(getTree).toHaveBeenCalledTimes(1));

        await act(async () => {
            window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: 'other' } }));
        });
        expect(getTree).toHaveBeenCalledTimes(1);

        await act(async () => {
            window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: 'ws1' } }));
        });
        await waitFor(() => expect(getTree).toHaveBeenCalledTimes(2));
    });

    it('reads notes from the workspace it is given (repo group ids included)', async () => {
        render(<DockNotesPanel workspaceId="group-ai-repos" />);
        await waitFor(() => expect(getTree).toHaveBeenCalledWith('group-ai-repos'));
        await waitFor(() => expect(itemPaths()).toHaveLength(2));
        fireEvent.click(screen.getByTestId('workspace-dock-notes-open-tab'));
        expect(location.hash).toContain('#repos/group-ai-repos/notes/');
    });
});
