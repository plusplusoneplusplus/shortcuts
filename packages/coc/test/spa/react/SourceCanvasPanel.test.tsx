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

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ explorer: { reveal: revealMock } }),
}));

// Repo attribution reads workspace names/roots; the panel is rendered here without
// AppProvider, so stand in for the live workspace list.
vi.mock('../../../src/server/spa/client/react/repos/workspacesWithRemote', () => ({
    useWorkspacesWithRemoteOptional: () => [
        { id: 'ws-vllm', name: 'vllm', rootPath: '/home/u/projects/vllm' },
        { id: 'ws-nixl', rootPath: '/home/u/projects/nixl' },
        { id: 'ws1', name: 'proj', rootPath: '/home/u/proj' },
    ],
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
// jsdom cannot run Monaco, and the code viewer inside SourceCanvasBody mounts
// it — stub the module the same way PreviewPane's read-only test does.
vi.mock('../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, language, readOnly, highlightRange }: any) => (
        <div
            data-testid="mock-monaco-editor"
            data-language={language}
            data-value={value}
            data-read-only={String(!!readOnly)}
            data-highlight-start={highlightRange ? String(highlightRange.start) : ''}
            data-highlight-end={highlightRange ? String(highlightRange.end) : ''}
        />
    ),
    getMonacoLanguage: (name: string) => {
        const parts = String(name).split('.');
        if (parts.length < 2) { return 'plaintext'; }
        const map: Record<string, string> = { ts: 'typescript', js: 'javascript', md: 'markdown' };
        return map[parts[parts.length - 1].toLowerCase()] ?? 'plaintext';
    },
    EXPLORER_EDITOR_OPTIONS: {},
    revealEditorLine: () => {},
    buildHighlightDecorations: () => [],
    EDITOR_HIGHLIGHT_CLASS: 'source-canvas-line-highlight',
}));

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

/** Put a real, non-collapsed selection over `el`'s text, like a copy drag would. */
function selectTextWithin(el: Element): void {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

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

    it('lays the file name and path out inline on a single header row', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        const group = getByTestId('source-canvas-header-titles');
        // Both the bold name and the muted path share one flex row (not stacked).
        expect(group.className).toContain('flex');
        expect(group.contains(getByTestId('source-canvas-filename'))).toBe(true);
        expect(group.contains(getByTestId('source-canvas-path'))).toBe(true);
    });

    it('truncates the header path from the front (keeps the meaningful tail)', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        const pathEl = getByTestId('source-canvas-path');
        // dir=rtl drops the low-signal prefix (ellipsis on the left)…
        expect(pathEl.getAttribute('dir')).toBe('rtl');
        // …while the full path stays in the DOM for the tooltip + copy action.
        expect(pathEl.textContent).toBe('/home/u/proj/src/foo.ts');
        expect(pathEl.getAttribute('title')).toBe('/home/u/proj/src/foo.ts');
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

    it('shows a source-file switcher with active state and disambiguating paths', () => {
        const onNavigate = vi.fn();
        const sourceFiles = [
            { fullPath: '/home/u/proj/lib/foo.ts', wsId: 'ws1', kind: 'code' as const, line: 7 },
            { fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' as const, line: 42 },
        ];
        const { getByTestId, getAllByRole } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                workspaceRootPath="/home/u/proj"
                sourceFiles={sourceFiles}
                onNavigate={onNavigate}
                onClose={() => {}}
            />,
        );

        const trigger = getByTestId('source-canvas-file-switcher-trigger');
        expect(trigger.textContent).toContain('foo.ts');
        expect(trigger.textContent).toContain('src/foo.ts');
        fireEvent.click(trigger);

        const options = getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options[0].textContent).toContain('lib/foo.ts');
        expect(options[1].textContent).toContain('src/foo.ts');
        expect(options[0].getAttribute('aria-selected')).toBe('false');
        expect(options[1].getAttribute('aria-selected')).toBe('true');
        expect(getByTestId('source-canvas-copy-btn')).toBeTruthy();
        expect(getByTestId('source-canvas-reveal-btn')).toBeTruthy();
        expect(getByTestId('source-canvas-close-btn')).toBeTruthy();

        fireEvent.click(options[0]);
        expect(onNavigate).toHaveBeenCalledWith(sourceFiles[0]);
        expect(getByTestId('source-canvas-file-switcher-trigger').getAttribute('aria-expanded')).toBe('false');
    });

    it('supports keyboard navigation and Escape dismissal for the source-file switcher', () => {
        const sourceFiles = [
            { fullPath: '/home/u/proj/lib/foo.ts', wsId: 'ws1', kind: 'code' as const },
            { fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' as const },
        ];
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                sourceFiles={sourceFiles}
                onNavigate={() => {}}
                onClose={() => {}}
            />,
        );

        const trigger = getByTestId('source-canvas-file-switcher-trigger');
        trigger.focus();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(getByTestId('source-canvas-file-switcher-menu')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(queryByTestId('source-canvas-file-switcher-menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('keeps the compact static header when only one source file is available', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                sourceFiles={[{ fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' }]}
                onNavigate={() => {}}
                onClose={() => {}}
            />,
        );

        expect(queryByTestId('source-canvas-file-switcher-trigger')).toBeNull();
        expect(getByTestId('source-canvas-header-titles')).toBeTruthy();
    });

    it('keeps an unresolved selected file in the canvas error state', () => {
        const onNavigate = vi.fn();
        const sourceFiles = [
            { fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' as const },
            { fullPath: '/home/u/proj/src/missing.ts', wsId: 'ws1', kind: 'code' as const, line: 9 },
        ];
        const { getByTestId, getAllByRole, rerender } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                sourceFiles={sourceFiles}
                onNavigate={onNavigate}
                onClose={() => {}}
            />,
        );

        fireEvent.click(getByTestId('source-canvas-file-switcher-trigger'));
        fireEvent.click(getAllByRole('option')[1]);
        expect(onNavigate).toHaveBeenCalledWith(sourceFiles[1]);

        rerender(
            <SourceCanvasPanel
                fileRef={sourceFiles[1]}
                wsId="ws1"
                sourceFiles={sourceFiles}
                onNavigate={onNavigate}
                content={{
                    status: 'error',
                    content: '',
                    language: '',
                    resolvedPath: '/home/u/proj/src/missing.ts',
                    error: 'File not found',
                }}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-error-msg').textContent).toBe(
            "Couldn't load /home/u/proj/src/missing.ts",
        );
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

    it('uses the server-resolved member workspace for header, copy, and reveal', async () => {
        const resolvedPath = '/home/u/projects/nixl/src/plugins/hf3fs/hf3fs_utils.cpp';
        const { getByTestId } = render(
            <SourceCanvasPanel
                fileRef={{
                    fullPath: 'src/plugins/hf3fs/hf3fs_utils.cpp',
                    wsId: 'group-ml',
                }}
                wsId="group-ml"
                workspaceRootPath="/home/u/.coc/repos/group-ml"
                content={{
                    status: 'success',
                    content: 'int main() {}',
                    language: 'cpp',
                    resolvedPath,
                    resolvedWorkspaceId: 'ws-nixl',
                    workspaceRootPath: '/home/u/projects/nixl',
                    error: '',
                }}
                onClose={() => {}}
            />,
        );

        expect(getByTestId('source-canvas-path').textContent).toBe(
            'src/plugins/hf3fs/hf3fs_utils.cpp',
        );
        expect(getByTestId('source-canvas-path').getAttribute('title')).toBe(resolvedPath);

        fireEvent.click(getByTestId('source-canvas-copy-btn'));
        await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(resolvedPath));
        fireEvent.click(getByTestId('source-canvas-reveal-btn'));
        expect(revealMock).toHaveBeenCalledWith('ws-nixl', resolvedPath);
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

    // --- Repo attribution in repo-group chats ---

    const groupFileRef = { fullPath: 'vllm/v1/engine/core.py', wsId: 'group-ml' };
    const successContent = (resolvedWorkspaceId: string, resolvedPath: string) => ({
        status: 'success' as const,
        content: 'x = 1\n',
        language: 'python',
        resolvedPath,
        resolvedWorkspaceId,
        error: '',
    });

    it('hides the repo chip in a single-repo chat', () => {
        const { queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                content={successContent('ws1', '/home/u/proj/src/foo.ts')}
                onClose={() => {}}
            />,
        );
        expect(queryByTestId('source-canvas-repo-chip')).toBeNull();
    });

    it('shows the owning member repo as a header chip in a repo-group chat', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel
                fileRef={groupFileRef}
                wsId="group-ml"
                content={successContent('ws-vllm', '/home/u/projects/vllm/v1/engine/core.py')}
                onClose={() => {}}
            />,
        );
        const chip = getByTestId('source-canvas-repo-chip');
        expect(chip.textContent).toBe('vllm');
        expect(chip.getAttribute('data-repo-ws-id')).toBe('ws-vllm');
        // The dot uses the stable per-workspace accent.
        const dot = chip.querySelector('span[style]') as HTMLElement;
        expect(dot.style.backgroundColor).toBeTruthy();
        // Header file name/path stay untouched.
        expect(getByTestId('source-canvas-filename').textContent).toBe('core.py');
    });

    it('omits the repo chip until the group member is resolved', () => {
        const { queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={groupFileRef}
                wsId="group-ml"
                content={{
                    status: 'loading',
                    content: '',
                    language: '',
                    resolvedPath: '',
                    error: '',
                }}
                onClose={() => {}}
            />,
        );
        expect(queryByTestId('source-canvas-repo-chip')).toBeNull();
    });

    it('groups switcher options by member repo, with opened-yet-unresolved files last', () => {
        const coreFile = { fullPath: 'vllm/v1/engine/core.py', wsId: 'group-ml', kind: 'code' as const };
        const nixlFile = { fullPath: 'src/plugins/hf3fs/utils.cpp', wsId: 'group-ml', kind: 'code' as const };
        const unopened = { fullPath: 'vllm/core/scheduler.py', wsId: 'group-ml', kind: 'code' as const };
        const sourceFiles = [coreFile, nixlFile, unopened];
        const onNavigate = vi.fn();

        const { getByTestId, queryByTestId, getAllByRole, rerender } = render(
            <SourceCanvasPanel
                fileRef={coreFile}
                wsId="group-ml"
                sourceFiles={sourceFiles}
                onNavigate={onNavigate}
                content={successContent('ws-vllm', '/home/u/projects/vllm/v1/engine/core.py')}
                onClose={() => {}}
            />,
        );

        // Only one repo resolved so far → the other files sit in the neutral bucket.
        fireEvent.click(getByTestId('source-canvas-file-switcher-trigger'));
        expect(getByTestId('source-canvas-file-group-ws-vllm').textContent).toBe('vllm');
        expect(getByTestId('source-canvas-file-group-unresolved').textContent).toBe('Other');
        fireEvent.click(getByTestId('source-canvas-file-switcher-trigger'));

        // Opening the nixl file records its owning member lazily.
        rerender(
            <SourceCanvasPanel
                fileRef={nixlFile}
                wsId="group-ml"
                sourceFiles={sourceFiles}
                onNavigate={onNavigate}
                content={successContent('ws-nixl', '/home/u/projects/nixl/src/plugins/hf3fs/utils.cpp')}
                onClose={() => {}}
            />,
        );

        fireEvent.click(getByTestId('source-canvas-file-switcher-trigger'));
        expect(getByTestId('source-canvas-file-group-ws-vllm')).toBeTruthy();
        expect(getByTestId('source-canvas-file-group-ws-nixl').textContent).toBe('nixl');
        expect(getByTestId('source-canvas-file-group-unresolved')).toBeTruthy();

        // All files remain selectable, and the active row carries its repo accent.
        const options = getAllByRole('option');
        expect(options).toHaveLength(3);
        const active = options.find((o) => o.getAttribute('aria-selected') === 'true')!;
        expect(active.textContent).toContain('utils.cpp');
        expect(active.getAttribute('style')).toContain('inset 2px 0 0');
        expect(queryByTestId('source-canvas-repo-chip')?.textContent).toBe('nixl');

        fireEvent.click(options[0]);
        expect(onNavigate).toHaveBeenCalledWith(coreFile);
    });

    it('keeps a flat switcher list (no repo headers) in a single-repo chat', () => {
        const sourceFiles = [
            { fullPath: '/home/u/proj/lib/foo.ts', wsId: 'ws1', kind: 'code' as const },
            { fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' as const },
        ];
        const { getByTestId, queryByTestId, getAllByRole } = render(
            <SourceCanvasPanel
                fileRef={sourceFiles[1]}
                wsId="ws1"
                sourceFiles={sourceFiles}
                onNavigate={() => {}}
                content={successContent('ws1', '/home/u/proj/src/foo.ts')}
                onClose={() => {}}
            />,
        );
        fireEvent.click(getByTestId('source-canvas-file-switcher-trigger'));
        expect(getAllByRole('option')).toHaveLength(2);
        expect(queryByTestId('source-canvas-file-group-ws1')).toBeNull();
        expect(queryByTestId('source-canvas-file-group-unresolved')).toBeNull();
    });

    // --- selectable switcher text ---

    it('marks the switcher trigger and options as selectable text', () => {
        const sourceFiles = [
            { fullPath: '/home/u/proj/lib/foo.ts', wsId: 'ws1', kind: 'code' as const },
            { fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' as const },
        ];
        const { getByTestId, getAllByRole } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                workspaceRootPath="/home/u/proj"
                sourceFiles={sourceFiles}
                onNavigate={() => {}}
                onClose={() => {}}
            />,
        );

        const trigger = getByTestId('source-canvas-file-switcher-trigger');
        expect(trigger.className).toContain('select-text');
        expect(getByTestId('source-canvas-filename').className).toContain('select-text');
        expect(getByTestId('source-canvas-path').className).toContain('select-text');

        fireEvent.click(trigger);
        for (const option of getAllByRole('option')) {
            expect(option.className).toContain('select-text');
        }
    });

    it('keeps a path selection instead of navigating when a switcher option is clicked', () => {
        const onNavigate = vi.fn();
        const sourceFiles = [
            { fullPath: '/home/u/proj/lib/foo.ts', wsId: 'ws1', kind: 'code' as const },
            { fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' as const },
        ];
        const { getByTestId, getAllByRole } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                workspaceRootPath="/home/u/proj"
                sourceFiles={sourceFiles}
                onNavigate={onNavigate}
                onClose={() => {}}
            />,
        );

        fireEvent.click(getByTestId('source-canvas-file-switcher-trigger'));
        const option = getAllByRole('option')[0];
        selectTextWithin(option);

        fireEvent.click(option);
        expect(onNavigate).not.toHaveBeenCalled();
        expect(getByTestId('source-canvas-file-switcher-menu')).toBeTruthy();

        // With the selection cleared the same click navigates as before.
        window.getSelection()?.removeAllRanges();
        fireEvent.click(option);
        expect(onNavigate).toHaveBeenCalledWith(sourceFiles[0]);
    });

    it('does not toggle the switcher when the header path is being selected', () => {
        const sourceFiles = [
            { fullPath: '/home/u/proj/lib/foo.ts', wsId: 'ws1', kind: 'code' as const },
            { fullPath: '/home/u/proj/src/foo.ts', wsId: 'ws1', kind: 'code' as const },
        ];
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                workspaceRootPath="/home/u/proj"
                sourceFiles={sourceFiles}
                onNavigate={() => {}}
                onClose={() => {}}
            />,
        );

        const trigger = getByTestId('source-canvas-file-switcher-trigger');
        selectTextWithin(getByTestId('source-canvas-path'));

        fireEvent.click(trigger);
        expect(queryByTestId('source-canvas-file-switcher-menu')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        window.getSelection()?.removeAllRanges();
        fireEvent.click(trigger);
        expect(getByTestId('source-canvas-file-switcher-menu')).toBeTruthy();
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

    it('renders the loaded source content on success (AC-04 read-only code viewer)', () => {
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
        // .ts → the read-only Monaco viewer, holding the fetched file text.
        const editor = getByTestId('mock-monaco-editor');
        expect(source.contains(editor)).toBe(true);
        expect(editor.getAttribute('data-value')).toBe('const x = 1;\n');
        expect(editor.getAttribute('data-language')).toBe('typescript');
        expect(editor.getAttribute('data-read-only')).toBe('true');
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

    // --- Expandable file-tree body (kind: 'dir') ---

    const dirRef = { fullPath: '/home/u/proj/src', kind: 'dir' as const };
    function treeSuccess(over: Record<string, unknown> = {}) {
        return {
            status: 'success' as const,
            rootEntries: [
                { name: 'sub', type: 'dir' as const, path: 'src/sub' },
                { name: 'a.ts', type: 'file' as const, path: 'src/a.ts' },
            ],
            resolvedPath: '/home/u/proj/src',
            relativePath: 'src',
            wsId: 'ws1',
            truncated: false,
            error: '',
            childrenMap: new Map(),
            expanded: new Set<string>(),
            loadingPaths: new Set<string>(),
            errorPaths: new Map<string, string>(),
            toggle: vi.fn(),
            ...over,
        };
    }

    it('renders the file tree (not the code viewer or note editor) for a dir ref', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={dirRef}
                wsId="ws1"
                tree={treeSuccess()}
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

    it('shows the folder loading state when no tree is provided', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={dirRef} wsId="ws1" onNavigate={() => {}} onClose={() => {}} />,
        );
        expect(getByTestId('source-canvas-dir-loading')).toBeTruthy();
    });

    it('expands a folder in place (not via onNavigate) when its row is clicked', () => {
        const onNavigate = vi.fn();
        const tree = treeSuccess();
        const { getAllByTestId } = render(
            <SourceCanvasPanel
                fileRef={dirRef}
                wsId="ws1"
                tree={tree}
                onNavigate={onNavigate}
                onClose={() => {}}
            />,
        );
        // First node is the subfolder — clicking it toggles expansion, not nav.
        fireEvent.click(getAllByTestId('source-canvas-tree-node')[0]);
        expect(tree.toggle).toHaveBeenCalledWith('src/sub');
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('opens a file row through onNavigate as kind: code', () => {
        const onNavigate = vi.fn();
        const { getAllByTestId } = render(
            <SourceCanvasPanel
                fileRef={dirRef}
                wsId="ws1"
                tree={treeSuccess()}
                onNavigate={onNavigate}
                onClose={() => {}}
            />,
        );
        // Second node is the file — clicking it opens the read-only viewer.
        fireEvent.click(getAllByTestId('source-canvas-tree-node')[1]);
        expect(onNavigate).toHaveBeenCalledWith(
            expect.objectContaining({ fullPath: 'src/a.ts', kind: 'code', wsId: 'ws1' }),
        );
    });
});
