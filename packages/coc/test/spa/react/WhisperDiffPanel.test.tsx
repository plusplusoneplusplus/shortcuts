/**
 * Tests for WhisperDiffPanel — a chat's captured file changes in the shared
 * review shell (`ReviewFiles` navigator + `MonacoFileDiffViewer`).
 *
 * The data comes from the real tool-call replay (`buildWhisperCombinedDiff`),
 * so the Monaco sides asserted here are the exact captured snapshot: a created
 * file opens against an empty original, snippet edits open as their snippets
 * only (under the patch-only notice), and deleted / non-reconstructable files
 * say no diff exists.
 * Monaco and the classic viewer are stubbed to their inputs.
 */
/* @vitest-environment jsdom */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';

const engine = vi.hoisted(() => ({ value: 'monaco' as 'monaco' | 'legacy', set: vi.fn() }));
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useDiffEngine', () => ({
    useDiffEngine: () => [engine.value, engine.set],
}));
vi.mock('../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, fileName, 'data-testid': testId }: any) => (
        <pre data-testid={testId} data-file-name={fileName}>{diff}</pre>
    ),
}));
const monacoMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer', async () => {
    const { useEffect } = await import('react');
    return {
        MonacoFileDiffViewer: (props: any) => {
            useEffect(() => { monacoMounts.count++; }, []);
            return (
                <div data-testid={props['data-testid']} data-workspace={props.workspaceId} data-path={props.relativePath}
                    data-stage={props.stage} data-model={props.modelIdentity} data-language={String(props.languageFeatures)}
                    data-editable={String(!!props.editable)} data-labels={props.lineLabels ? JSON.stringify(props.lineLabels) : undefined}>
                    <pre data-testid="monaco-original">{props.original}</pre>
                    <pre data-testid="monaco-modified">{props.modified}</pre>
                    <button type="button" data-testid="monaco-fail" onClick={() => props.onEditorError(new Error('boom'))}>fail</button>
                </div>
            );
        },
    };
});

import { WhisperDiffPanel } from '../../../src/server/spa/client/react/features/chat/whisper-diff/WhisperDiffPanel';
import { SNIPPET_GAP } from '../../../src/server/spa/client/react/features/chat/whisper-diff/whisperReviewModel';
import type { WhisperDiffState } from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffState';
import { buildWhisperCombinedDiff } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperCombinedDiff';
import { collectFileEdits, computeFileEditTotals } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

const ROOT = '/home/u/proj';
const CREATED_TEXT = 'export const a = 1;\nexport const b = 2;\n';

type Call = { toolName: string; args: Record<string, unknown> };
const BASE_CALLS: Call[] = [
    { toolName: 'create', args: { path: `${ROOT}/src/new.ts`, file_text: CREATED_TEXT } },
    { toolName: 'edit', args: { path: `${ROOT}/src/sub/edit.ts`, old_str: 'old line', new_str: 'new line' } },
    { toolName: 'create', args: { path: `${ROOT}/src/gone.ts`, file_text: 'temp\n' } },
    { toolName: 'bash', args: { command: `rm -f ${ROOT}/src/gone.ts` } },
    { toolName: 'apply_patch', args: { changes: [{ path: `${ROOT}/src/codex.ts`, kind: 'update' }] } },
];

function stateFrom(calls: Call[], over: Partial<WhisperDiffState> = {}): WhisperDiffState {
    const files = collectFileEdits(calls);
    const built = buildWhisperCombinedDiff(calls, files);
    const totals = computeFileEditTotals(files);
    return {
        status: built.sections.length ? 'success' : 'empty',
        view: { ...built, fileCount: files.length, ...totals },
        files,
        error: built.sections.length ? '' : 'No diff is available for these files.',
        workspaceId: 'repo-a',
        ...over,
    };
}

function renderPanel(state: WhisperDiffState, onClose = () => {}) {
    return render(<WhisperDiffPanel state={state} workspaceRootPath={ROOT} onClose={onClose} />);
}

const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
const rowPaths = () => within(nav()).getAllByRole('button').map(b => b.getAttribute('data-file-path')).filter(Boolean);
const selectedPath = () => nav().querySelector('[aria-current="true"]')?.getAttribute('data-file-path');
const fileBody = () => screen.getByTestId('whisper-diff-file');
function clickRow(path: string) {
    fireEvent.click(nav().querySelector(`[data-file-path="${path}"]`)!);
}

beforeEach(() => {
    cleanup();
    engine.value = 'monaco';
    monacoMounts.count = 0;
    localStorage.clear();
});

describe('WhisperDiffPanel — shared review navigator', () => {
    it('lists every captured file in the shared tree with a resize separator', () => {
        renderPanel(stateFrom(BASE_CALLS));
        expect(screen.getByTestId('git-file-review')).toBeInTheDocument();
        // Tree order: folders first, then files, each sorted.
        expect(rowPaths()).toEqual(['src/sub/edit.ts', 'src/codex.ts', 'src/gone.ts', 'src/new.ts']);
        expect(within(nav()).getByRole('button', { name: 'src/sub' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('separator', { name: 'Resize changed files list' })).toBeInTheDocument();
        expect(screen.getByTestId('whisper-diff-totals')).toHaveTextContent('4 files');
    });

    it('carries add / modify / delete status and line counts on each row', () => {
        renderPanel(stateFrom(BASE_CALLS));
        expect(nav().querySelector('[data-file-path="src/new.ts"]')).toHaveAccessibleName(/src\/new\.ts, Added/);
        expect(nav().querySelector('[data-file-path="src/sub/edit.ts"]')).toHaveAccessibleName(/Modified/);
        expect(nav().querySelector('[data-file-path="src/gone.ts"]')).toHaveAccessibleName(/Deleted/);
        expect(nav().querySelector('[data-file-path="src/new.ts"]')).toHaveTextContent('+3');
    });

    it('opens the aggregate entry (no focus) on the first file in tree order', () => {
        renderPanel(stateFrom(BASE_CALLS));
        expect(selectedPath()).toBe('src/sub/edit.ts');
    });

    it('opens a file-row entry focused on that file', () => {
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/sub/edit.ts` }));
        expect(selectedPath()).toBe('src/sub/edit.ts');
        expect(fileBody()).toHaveAttribute('data-path', 'src/sub/edit.ts');
    });

    it('selects a file when its row is clicked', () => {
        renderPanel(stateFrom(BASE_CALLS));
        clickRow('src/new.ts');
        expect(selectedPath()).toBe('src/new.ts');
        expect(fileBody()).toHaveAttribute('data-content', 'whole');
    });

    it('moves through files with the shared previous / next controls', () => {
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/sub/edit.ts` }));
        fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
        expect(selectedPath()).toBe('src/codex.ts');
        fireEvent.click(screen.getByRole('button', { name: 'Previous file' }));
        expect(selectedPath()).toBe('src/sub/edit.ts');
    });

    it('closes from the toolbar close action', () => {
        const onClose = vi.fn();
        renderPanel(stateFrom(BASE_CALLS), onClose);
        fireEvent.click(screen.getByTestId('whisper-diff-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows the empty message when nothing was captured', () => {
        renderPanel(stateFrom([]));
        expect(screen.getByTestId('whisper-diff-empty')).toHaveTextContent('No diff is available');
    });
});

describe('WhisperDiffPanel — captured snapshot content', () => {
    it('opens a created file in Monaco against an empty original and the exact created text', () => {
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/new.ts` }));
        const editor = screen.getByTestId('whisper-diff-editor');
        expect(editor).toHaveAttribute('data-path', 'src/new.ts');
        expect(editor).toHaveAttribute('data-workspace', 'repo-a');
        expect(editor).toHaveAttribute('data-stage', 'staged');
        expect(editor).toHaveAttribute('data-language', 'false');
        expect(editor).toHaveAttribute('data-editable', 'false');
        expect(editor.getAttribute('data-model')).toMatch(/^chat-change-/);
        expect(screen.getByTestId('monaco-original').textContent).toBe('');
        expect(screen.getByTestId('monaco-modified').textContent).toBe(CREATED_TEXT);
        expect(screen.queryByTestId('whisper-diff-viewer')).toBeNull();
    });

    it('opens a snippet edit in Monaco as the snippet only, under the patch-only notice', () => {
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/sub/edit.ts` }));
        expect(screen.getByTestId('whisper-diff-patch-only')).toHaveTextContent('Only the edited snippets');
        const editor = screen.getByTestId('whisper-diff-editor');
        expect(editor).toHaveAttribute('data-path', 'src/sub/edit.ts');
        expect(editor).toHaveAttribute('data-workspace', 'repo-a');
        expect(editor).toHaveAttribute('data-language', 'false');
        expect(editor).toHaveAttribute('data-editable', 'false');
        expect(editor.getAttribute('data-model')).toMatch(/^chat-change-/);
        // The captured snippet, never the working file; no made-up positions.
        expect(screen.getByTestId('monaco-original').textContent).toBe(`${SNIPPET_GAP}\nold line`);
        expect(screen.getByTestId('monaco-modified').textContent).toBe(`${SNIPPET_GAP}\nnew line`);
        expect(JSON.parse(editor.getAttribute('data-labels')!)).toEqual({ original: ['', ''], modified: ['', ''] });
        expect(screen.queryByTestId('whisper-diff-viewer')).toBeNull();
        expect(screen.getByTestId('diff-engine-toggle')).toBeInTheDocument();
    });

    it('keeps several anchored hunks apart with their captured line numbers', () => {
        const patch = [
            'diff --git a/src/p.ts b/src/p.ts', '--- a/src/p.ts', '+++ b/src/p.ts',
            '@@ -3,2 +3,2 @@', ' a', '-b', '+B',
            '@@ -30,1 +30,2 @@', ' y', '+z',
        ].join('\n');
        renderPanel(stateFrom([{ toolName: 'apply_patch', args: { input: patch } }]));
        expect(screen.getByTestId('whisper-diff-patch-only')).toBeInTheDocument();
        expect(screen.getByTestId('monaco-original').textContent).toBe('@@ -3,2 +3,2 @@\na\nb\n@@ -30,1 +30,2 @@\ny');
        expect(screen.getByTestId('monaco-modified').textContent).toBe('@@ -3,2 +3,2 @@\na\nB\n@@ -30,1 +30,2 @@\ny\nz');
        expect(JSON.parse(screen.getByTestId('whisper-diff-editor').getAttribute('data-labels')!)).toEqual({
            original: ['', '3', '4', '', '30'],
            modified: ['', '3', '4', '', '30', '31'],
        });
    });

    it('honours the Classic engine preference for a snippet edit', () => {
        engine.value = 'legacy';
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/sub/edit.ts` }));
        expect(screen.queryByTestId('whisper-diff-editor')).toBeNull();
        expect(screen.getByTestId('whisper-diff-patch-only')).toBeInTheDocument();
        const patch = screen.getByTestId('whisper-diff-viewer').textContent ?? '';
        expect(patch).toContain('-old line');
        expect(patch).toContain('+new line');
    });

    it('opens a created-then-edited file as two separate snippets', () => {
        const calls: Call[] = [
            { toolName: 'create', args: { path: `${ROOT}/a.ts`, file_text: 'one\n' } },
            { toolName: 'edit', args: { path: `${ROOT}/a.ts`, old_str: 'one', new_str: 'two' } },
        ];
        renderPanel(stateFrom(calls));
        expect(fileBody()).toHaveAttribute('data-content', 'patch');
        expect(screen.getByTestId('monaco-original').textContent).toBe(`${SNIPPET_GAP}\n${SNIPPET_GAP}\none`);
        expect(screen.getByTestId('monaco-modified').textContent).toBe(`${SNIPPET_GAP}\none\n\n${SNIPPET_GAP}\ntwo`);
    });

    it('says no diff was captured for deleted and non-reconstructable files', () => {
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/gone.ts` }));
        expect(screen.getByTestId('whisper-diff-no-diff')).toHaveTextContent('deleted this file');
        clickRow('src/codex.ts');
        expect(screen.getByTestId('whisper-diff-no-diff')).toHaveTextContent('no line content');
        expect(screen.queryByTestId('whisper-diff-editor')).toBeNull();
    });

    it('honours the Classic engine preference for a created file', () => {
        engine.value = 'legacy';
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/new.ts` }));
        expect(screen.queryByTestId('whisper-diff-editor')).toBeNull();
        expect(screen.getByTestId('whisper-diff-viewer').textContent).toContain('+export const a = 1;');
        fireEvent.click(screen.getByTestId('diff-engine-toggle'));
        expect(engine.set).toHaveBeenCalledWith('monaco');
    });

    it('falls back to the classic diff when the editor fails, and Retry remounts it', () => {
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/new.ts` }));
        fireEvent.click(screen.getByTestId('monaco-fail'));
        expect(screen.getByTestId('diff-engine-fallback-banner')).toHaveAttribute('data-reason', 'editorFailed');
        expect(screen.getByTestId('whisper-diff-viewer')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('diff-engine-fallback-retry'));
        expect(screen.getByTestId('whisper-diff-editor')).toBeInTheDocument();
        expect(monacoMounts.count).toBe(2);
    });

    it('gives different snapshots of one path different editor models', () => {
        const first = stateFrom([{ toolName: 'create', args: { path: `${ROOT}/a.ts`, file_text: 'v1\n' } }]);
        const { unmount } = renderPanel(first);
        const firstModel = screen.getByTestId('whisper-diff-editor').getAttribute('data-model');
        unmount();
        renderPanel(stateFrom([{ toolName: 'create', args: { path: `${ROOT}/a.ts`, file_text: 'v2\n' } }]));
        expect(screen.getByTestId('whisper-diff-editor').getAttribute('data-model')).not.toBe(firstModel);
        expect(screen.getByTestId('monaco-modified').textContent).toBe('v2\n');
    });

    it('is read-only: no save, comment or chat affordances', () => {
        renderPanel(stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/new.ts` }));
        for (const name of [/save/i, /comment/i, /ask ai/i]) {
            expect(screen.queryByRole('button', { name })).toBeNull();
        }
    });
});

describe('WhisperDiffPanel — selection lifetime and ownership', () => {
    it('keeps the picked file when a live source rebuilds under the same key', () => {
        const { rerender } = renderPanel(stateFrom(BASE_CALLS, { selectionKey: 'chat-1\n' }));
        clickRow('src/sub/edit.ts');
        const grown = stateFrom([...BASE_CALLS, { toolName: 'edit', args: { path: `${ROOT}/src/later.ts`, old_str: 'x', new_str: 'y' } }], { selectionKey: 'chat-1\n' });
        rerender(<WhisperDiffPanel state={grown} workspaceRootPath={ROOT} onClose={() => {}} />);
        expect(rowPaths()).toContain('src/later.ts');
        expect(selectedPath()).toBe('src/sub/edit.ts');
    });

    it('resets on a new open of a frozen context', () => {
        const { rerender } = renderPanel(stateFrom(BASE_CALLS));
        clickRow('src/sub/edit.ts');
        rerender(<WhisperDiffPanel state={stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/new.ts` })} workspaceRootPath={ROOT} onClose={() => {}} />);
        expect(selectedPath()).toBe('src/new.ts');
        // Reopening the same file after navigating away lands on it again.
        clickRow('src/codex.ts');
        rerender(<WhisperDiffPanel state={stateFrom(BASE_CALLS, { focusPath: `${ROOT}/src/new.ts` })} workspaceRootPath={ROOT} onClose={() => {}} />);
        expect(selectedPath()).toBe('src/new.ts');
    });

    it('keeps the same rerendered state on the user selection', () => {
        const state = stateFrom(BASE_CALLS);
        const { rerender } = renderPanel(state);
        clickRow('src/sub/edit.ts');
        rerender(<WhisperDiffPanel state={state} workspaceRootPath={ROOT} onClose={() => {}} />);
        expect(selectedPath()).toBe('src/sub/edit.ts');
    });

    it('scopes editor models and review state to the owning workspace', () => {
        const { rerender } = renderPanel(stateFrom(BASE_CALLS, { selectionKey: 'k', focusPath: `${ROOT}/src/new.ts` }));
        clickRow('src/sub/edit.ts');
        const other = stateFrom(BASE_CALLS, { selectionKey: 'k', focusPath: `${ROOT}/src/new.ts`, workspaceId: 'remote:srv:repo-a' });
        rerender(<WhisperDiffPanel state={other} workspaceRootPath={ROOT} onClose={() => {}} />);
        // A different owner is a different review: selection does not carry over.
        expect(selectedPath()).toBe('src/new.ts');
        expect(screen.getByTestId('whisper-diff-editor')).toHaveAttribute('data-workspace', 'remote:srv:repo-a');
    });
});
