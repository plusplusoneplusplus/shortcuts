/**
 * Tests for SourceCanvasPanel — the docked read-only viewer chrome (AC-02).
 * Covers the header (file name + full path), close (X), copy-path, and
 * reveal-in-explorer actions.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const { revealMock, writeTextMock } = vi.hoisted(() => ({
    revealMock: vi.fn(() => Promise.resolve()),
    writeTextMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ explorer: { reveal: revealMock } }),
}));

// Stub the editable note body so the panel test stays focused on the body-mode
// branch (kind: 'note' → editable editor; code → read-only viewer) without
// pulling in the full NoteEditor / TipTap stack.
vi.mock('../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasNoteEditor', () => ({
    SourceCanvasNoteEditor: ({ fileRef }: any) => (
        <div data-testid="source-canvas-note-editor-stub" data-full-path={fileRef.fullPath} />
    ),
}));

// Stub the pop-out button (AC-03) — it pulls in App/Toast/MarkdownPopOut
// contexts; its own behavior is covered in SourceCanvasNotePopOutButton.test.tsx.
vi.mock('../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasNotePopOutButton', () => ({
    SourceCanvasNotePopOutButton: ({ onClose }: any) => (
        <button type="button" data-testid="source-canvas-popout-btn" onClick={onClose} />
    ),
}));

import { SourceCanvasPanel } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasPanel';

beforeEach(() => {
    revealMock.mockClear();
    writeTextMock.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: writeTextMock },
    });
});

describe('SourceCanvasPanel', () => {
    const fileRef = { fullPath: '/home/u/proj/src/foo.ts', line: 42 };

    it('renders the file name and full path in the header', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        expect(getByTestId('source-canvas-filename').textContent).toBe('foo.ts');
        expect(getByTestId('source-canvas-path').textContent).toBe('/home/u/proj/src/foo.ts');
        expect(getByTestId('source-canvas-path').getAttribute('title')).toBe(
            '/home/u/proj/src/foo.ts',
        );
    });

    it('renders a project-relative header path with the absolute path as tooltip', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                workspaceRootPath="/home/u/proj"
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-filename').textContent).toBe('foo.ts');
        expect(getByTestId('source-canvas-path').textContent).toBe('src/foo.ts');
        expect(getByTestId('source-canvas-path').getAttribute('title')).toBe(
            '/home/u/proj/src/foo.ts',
        );
    });

    it('prefers displayPath when provided', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel
                fileRef={{ fullPath: '/abs/proj/src/foo.ts', displayPath: 'src/foo.ts' }}
                wsId="ws1"
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-filename').textContent).toBe('foo.ts');
        expect(getByTestId('source-canvas-path').textContent).toBe('src/foo.ts');
        expect(getByTestId('source-canvas-path').getAttribute('title')).toBe('/abs/proj/src/foo.ts');
    });

    it('close button invokes onClose', () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={onClose} />,
        );
        fireEvent.click(getByTestId('source-canvas-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('copy button writes the bare full path to the clipboard', async () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        fireEvent.click(getByTestId('source-canvas-copy-btn'));
        await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('/home/u/proj/src/foo.ts'));
    });

    it('reveal button calls explorer.reveal with workspace id and bare path', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        fireEvent.click(getByTestId('source-canvas-reveal-btn'));
        expect(revealMock).toHaveBeenCalledWith('ws1', '/home/u/proj/src/foo.ts');
    });

    it('reveal button is disabled (and no-ops) without a workspace id', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId={null} onClose={() => {}} />,
        );
        const btn = getByTestId('source-canvas-reveal-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        fireEvent.click(btn);
        expect(revealMock).not.toHaveBeenCalled();
    });

    // --- AC-06: body load/error/success states ---

    it('shows the loading state when no content is provided', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        expect(getByTestId('source-canvas-loading')).toBeTruthy();
    });

    it('shows the loading state for content status "loading"', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                content={{ status: 'loading', content: '', language: '', resolvedPath: '', error: '' }}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-loading')).toBeTruthy();
    });

    it('renders an error with the attempted path and reason', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                content={{
                    status: 'error',
                    content: '',
                    language: '',
                    resolvedPath: '/home/u/proj/src/foo.ts',
                    error: 'No workspace available',
                }}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-error-msg').textContent).toBe(
            "Couldn't load /home/u/proj/src/foo.ts",
        );
        expect(getByTestId('source-canvas-error').textContent).toContain('No workspace available');
        expect(queryByTestId('source-canvas-loading')).toBeNull();
        expect(queryByTestId('source-canvas-source')).toBeNull();
    });

    it('renders the loaded source content on success (AC-04 line-gutter view)', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                content={{
                    status: 'success',
                    content: 'const x = 1;\n',
                    language: 'typescript',
                    resolvedPath: '/home/u/proj/src/foo.ts',
                    error: '',
                }}
                onClose={() => {}}
            />,
        );
        const source = getByTestId('source-canvas-source');
        // .ts → syntax-highlighted source with a line-number gutter (one row).
        expect(source.textContent).toContain('const x = 1;');
        expect(source.querySelectorAll('.source-canvas-line')).toHaveLength(1);
        expect(source.querySelector('.source-canvas-line-number')?.textContent).toBe('1');
        expect(queryByTestId('source-canvas-loading')).toBeNull();
        expect(queryByTestId('source-canvas-error')).toBeNull();
    });

    // --- AC-02: single slot, two body modes (note vs code) ---

    it('renders the editable note editor (not the read-only viewer) for a markdown note ref', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={{ fullPath: '/home/u/proj/notes/x.md', kind: 'note' }}
                wsId="ws1"
                onClose={() => {}}
            />,
        );
        // Editable body present…
        expect(getByTestId('source-canvas-note-editor-stub')).toBeTruthy();
        // …and the read-only loading/source viewer is NOT mounted for notes.
        expect(queryByTestId('source-canvas-loading')).toBeNull();
        expect(queryByTestId('source-canvas-source')).toBeNull();
    });

    it('shows all four header actions (incl. Pop out) only in note/editable mode (AC-03)', () => {
        const { getByTestId, queryByTestId, rerender } = render(
            <SourceCanvasPanel
                fileRef={{ fullPath: '/home/u/proj/notes/x.md', kind: 'note' }}
                wsId="ws1"
                onClose={() => {}}
            />,
        );
        // Copy path, Reveal, Pop out, Close — and no minimize/maximize.
        expect(getByTestId('source-canvas-copy-btn')).toBeTruthy();
        expect(getByTestId('source-canvas-reveal-btn')).toBeTruthy();
        expect(getByTestId('source-canvas-popout-btn')).toBeTruthy();
        expect(getByTestId('source-canvas-close-btn')).toBeTruthy();
        expect(queryByTestId('source-canvas-minimize-btn')).toBeNull();
        expect(queryByTestId('source-canvas-maximize-btn')).toBeNull();

        // Code mode keeps the original three actions (no Pop out).
        rerender(
            <SourceCanvasPanel
                fileRef={{ fullPath: '/home/u/proj/src/foo.ts', kind: 'code' }}
                wsId="ws1"
                content={{ status: 'loading', content: '', language: '', resolvedPath: '', error: '' }}
                onClose={() => {}}
            />,
        );
        expect(queryByTestId('source-canvas-popout-btn')).toBeNull();
    });

    it('renders the read-only source viewer (not the note editor) for a code ref', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={{ fullPath: '/home/u/proj/src/foo.ts', kind: 'code' }}
                wsId="ws1"
                content={{
                    status: 'success',
                    content: 'const x = 1;\n',
                    language: 'typescript',
                    resolvedPath: '/home/u/proj/src/foo.ts',
                    error: '',
                }}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-source')).toBeTruthy();
        expect(queryByTestId('source-canvas-note-editor-stub')).toBeNull();
    });

    // --- AC-01/AC-02: folder explorer body (kind: 'dir') ---

    const dirRef = { fullPath: '/home/u/proj/src', kind: 'dir' as const };
    const dirSuccess = {
        status: 'success' as const,
        entries: [
            { name: 'sub', type: 'dir' as const, path: 'src/sub' },
            { name: 'a.ts', type: 'file' as const, path: 'src/a.ts' },
        ],
        resolvedPath: '/home/u/proj/src',
        relativePath: 'src',
        wsId: 'ws1',
        truncated: false,
        error: '',
    };

    it('renders the folder explorer (not the code viewer or note editor) for a dir ref', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={dirRef}
                wsId="ws1"
                directory={dirSuccess}
                onNavigate={() => {}}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-listing')).toBeTruthy();
        expect(getByTestId('source-canvas-filename').textContent).toBe('src');
        expect(queryByTestId('source-canvas-source')).toBeNull();
        expect(queryByTestId('source-canvas-note-editor-stub')).toBeNull();
        // Pop-out is note-only; it must not appear in folder mode.
        expect(queryByTestId('source-canvas-popout-btn')).toBeNull();
    });

    it('shows the folder loading state when no directory is provided', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={dirRef} wsId="ws1" onNavigate={() => {}} onClose={() => {}} />,
        );
        expect(getByTestId('source-canvas-dir-loading')).toBeTruthy();
    });

    it('navigates in-place when a folder entry is clicked (AC-02)', () => {
        const onNavigate = vi.fn();
        const { getAllByTestId } = render(
            <SourceCanvasPanel
                fileRef={dirRef}
                wsId="ws1"
                directory={dirSuccess}
                onNavigate={onNavigate}
                onClose={() => {}}
            />,
        );
        fireEvent.click(getAllByTestId('source-canvas-dir-entry')[0]);
        expect(onNavigate).toHaveBeenCalledWith(
            expect.objectContaining({ fullPath: 'src/sub', kind: 'dir', wsId: 'ws1' }),
        );
    });
});
