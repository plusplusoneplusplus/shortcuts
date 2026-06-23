/**
 * Tests for SourceCanvasDock — the mobile-vs-desktop host shell for the docked
 * source-file canvas (AC-05).
 *
 * Mobile (`isMobile`) → the panel renders inside a `BottomSheet`; the editable
 * NoteEditor for a markdown note must live inside that sheet (not a desktop
 * column, not the floating dialog). Desktop → a resizable sibling column.
 *
 * The real `SourceCanvasPanel` is rendered so the test exercises the actual
 * Dock → BottomSheet → Panel composition; only the heavy NoteEditor / pop-out
 * leaves are stubbed (same approach as SourceCanvasPanel.test.tsx).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ explorer: { reveal: vi.fn(() => Promise.resolve()) } }),
}));

// Stub the editable note body so the dock test stays focused on the shell
// (BottomSheet vs column) without pulling in the full NoteEditor / TipTap stack.
vi.mock('../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasNoteEditor', () => ({
    SourceCanvasNoteEditor: ({ fileRef }: any) => (
        <div data-testid="source-canvas-note-editor-stub" data-full-path={fileRef.fullPath} />
    ),
}));

// Stub the pop-out button — it pulls in App/Toast/MarkdownPopOut contexts.
vi.mock('../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasNotePopOutButton', () => ({
    SourceCanvasNotePopOutButton: ({ onClose }: any) => (
        <button type="button" data-testid="source-canvas-popout-btn" onClick={onClose} />
    ),
}));

import { SourceCanvasDock } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasDock';

const resize = { width: 560, handleMouseDown: vi.fn(), handleTouchStart: vi.fn() };
const noteRef = { fullPath: '/home/u/proj/notes/x.md', kind: 'note' as const };
const codeRef = { fullPath: '/home/u/proj/src/foo.ts', kind: 'code' as const };
const dirRef = { fullPath: '/home/u/proj/src', kind: 'dir' as const };
const dirSuccess = {
    status: 'success' as const,
    entries: [{ name: 'sub', type: 'dir' as const, path: 'src/sub' }],
    resolvedPath: '/home/u/proj/src',
    relativePath: 'src',
    wsId: 'ws1',
    truncated: false,
    error: '',
};

describe('SourceCanvasDock', () => {
    it('hosts the editable note editor inside a BottomSheet at the mobile breakpoint (AC-05)', () => {
        render(
            <SourceCanvasDock
                fileRef={noteRef}
                wsId="ws1"
                isMobile
                onClose={() => {}}
                resize={resize}
            />,
        );
        const sheet = screen.getByTestId('bottomsheet-panel');
        expect(sheet).toBeTruthy();
        // The editable NoteEditor renders *inside* the BottomSheet shell…
        const editor = screen.getByTestId('source-canvas-note-editor-stub');
        expect(sheet.contains(editor)).toBe(true);
        expect(editor.getAttribute('data-full-path')).toBe('/home/u/proj/notes/x.md');
        // …and the desktop column is NOT rendered on mobile.
        expect(screen.queryByTestId('source-canvas-column')).toBeNull();
        expect(screen.queryByTestId('source-canvas-resize-handle')).toBeNull();
    });

    it('uses the resizable desktop column (not a BottomSheet) when not mobile', () => {
        render(
            <SourceCanvasDock
                fileRef={noteRef}
                wsId="ws1"
                isMobile={false}
                onClose={() => {}}
                resize={resize}
            />,
        );
        const column = screen.getByTestId('source-canvas-column');
        expect(column).toBeTruthy();
        expect((column as HTMLElement).style.width).toBe('560px');
        expect(screen.getByTestId('source-canvas-resize-handle')).toBeTruthy();
        // The note editor renders in the column, and there is no BottomSheet.
        expect(column.contains(screen.getByTestId('source-canvas-note-editor-stub'))).toBe(true);
        expect(screen.queryByTestId('bottomsheet-panel')).toBeNull();
    });

    it('hosts the read-only code viewer inside the BottomSheet for a code ref on mobile', () => {
        render(
            <SourceCanvasDock
                fileRef={codeRef}
                wsId="ws1"
                content={{
                    status: 'success',
                    content: 'const x = 1;\n',
                    language: 'typescript',
                    resolvedPath: '/home/u/proj/src/foo.ts',
                    error: '',
                }}
                isMobile
                onClose={() => {}}
                resize={resize}
            />,
        );
        const sheet = screen.getByTestId('bottomsheet-panel');
        // Read-only source viewer inside the sheet; no editable note editor.
        expect(sheet.contains(screen.getByTestId('source-canvas-source'))).toBe(true);
        expect(screen.queryByTestId('source-canvas-note-editor-stub')).toBeNull();
    });

    it('hosts the read-only folder explorer in the desktop column and forwards navigation (AC-01/AC-02)', () => {
        const onNavigate = vi.fn();
        render(
            <SourceCanvasDock
                fileRef={dirRef}
                wsId="ws1"
                directory={dirSuccess}
                onNavigate={onNavigate}
                isMobile={false}
                onClose={() => {}}
                resize={resize}
            />,
        );
        const column = screen.getByTestId('source-canvas-column');
        const listing = screen.getByTestId('source-canvas-dir-listing');
        expect(column.contains(listing)).toBe(true);
        // No code viewer / note editor when listing a folder.
        expect(screen.queryByTestId('source-canvas-source')).toBeNull();
        expect(screen.queryByTestId('source-canvas-note-editor-stub')).toBeNull();
        // Clicking a subfolder routes back through onNavigate (in-place navigation).
        fireEvent.click(screen.getByTestId('source-canvas-dir-entry'));
        expect(onNavigate).toHaveBeenCalledWith(
            expect.objectContaining({ fullPath: 'src/sub', kind: 'dir' }),
        );
    });

    it('hosts the folder explorer inside the BottomSheet for a dir ref on mobile', () => {
        render(
            <SourceCanvasDock
                fileRef={dirRef}
                wsId="ws1"
                directory={dirSuccess}
                onNavigate={() => {}}
                isMobile
                onClose={() => {}}
                resize={resize}
            />,
        );
        const sheet = screen.getByTestId('bottomsheet-panel');
        expect(sheet.contains(screen.getByTestId('source-canvas-dir-listing'))).toBe(true);
    });
});
