/**
 * Wiring tests for MonacoFileDiffViewer (AC-03): toolbar mode, models, theme,
 * hunk commands, lifecycle callbacks and cross-file navigation reach the owned
 * editor adapter. Monaco itself is not loaded; the adapter is a test double
 * that records calls and lets the test decide when the diff is computed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef, useRef, type RefObject } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import {
    MonacoFileDiffViewer,
    type MonacoFileDiffViewerHandle,
    type MonacoFileDiffViewerProps,
} from '../../../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer';
import { buildDiffModels } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';
import { useCrossFileNav } from '../../../../../../src/server/spa/client/react/features/git/hooks/useCrossFileNav';
import type { DiffLineChange } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import { createFakeDiffEditor, deferred, flush, type FakeDiffEditor } from './fakeDiffEditorAdapter';

let appTheme: 'auto' | 'dark' | 'light' = 'light';
vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: appTheme, setTheme: () => {} }),
}));

const change = (o1: number, o2: number, m1: number, m2: number): DiffLineChange => ({
    originalStartLineNumber: o1, originalEndLineNumber: o2, modifiedStartLineNumber: m1, modifiedEndLineNumber: m2,
});
const TWO_HUNKS = [change(2, 2, 2, 2), change(8, 0, 9, 10)];

function harness(overrides: Partial<MonacoFileDiffViewerProps> = {}) {
    const fakes: FakeDiffEditor[] = [];
    const createEditor = vi.fn(async (_host: HTMLElement, options) => {
        const fake = createFakeDiffEditor(options);
        fakes.push(fake);
        return fake.adapter;
    });
    const ref = createRef<MonacoFileDiffViewerHandle>();
    const props: MonacoFileDiffViewerProps = {
        workspaceId: 'ws-1',
        relativePath: 'src/a.ts',
        stage: 'unstaged',
        original: 'one\ntwo\n',
        modified: 'one\nTWO\n',
        viewMode: 'unified',
        createEditor,
        ...overrides,
    };
    const view = render(<MonacoFileDiffViewer ref={ref} {...props} />);
    const rerender = (next: Partial<MonacoFileDiffViewerProps>) =>
        view.rerender(<MonacoFileDiffViewer ref={ref} {...props} {...next} />);
    return { ...view, ref, fakes, createEditor, rerender, fake: () => fakes[0] };
}

beforeEach(() => { appTheme = 'light'; });

describe('MonacoFileDiffViewer — editor inputs', () => {
    it('shows the loading state until the editor attaches', async () => {
        const pending = deferred<ReturnType<typeof createFakeDiffEditor>['adapter']>();
        const fake = createFakeDiffEditor();
        const h = harness({ createEditor: vi.fn(() => pending.promise) });
        expect(screen.getByTestId('monaco-file-diff-viewer-loading')).toBeTruthy();
        await act(async () => { pending.resolve(fake.adapter); await flush(); });
        expect(screen.queryByTestId('monaco-file-diff-viewer-loading')).toBeNull();
        h.unmount();
    });

    it('creates one editor in its host with the unified options and read-only sides', async () => {
        const h = harness();
        await act(flush);
        expect(h.createEditor).toHaveBeenCalledTimes(1);
        const [host, options] = h.createEditor.mock.calls[0];
        expect(host).toBe(screen.getByTestId('monaco-file-diff-viewer-host'));
        expect(options).toMatchObject({ renderSideBySide: false, readOnly: true, originalEditable: false, renderOverviewRuler: true });
    });

    it('the toolbar view mode reaches the editor as renderSideBySide', async () => {
        const h = harness();
        await act(flush);
        h.rerender({ viewMode: 'split' });
        expect(h.fake().options.at(-1)?.renderSideBySide).toBe(true);
        h.rerender({ viewMode: 'unified' });
        expect(h.fake().options.at(-1)?.renderSideBySide).toBe(false);
        expect(h.createEditor).toHaveBeenCalledTimes(1);
    });

    it('unstaged: models are index (synthetic) → disk (real URI) with the file language', async () => {
        const h = harness();
        await act(flush);
        expect(h.fake().models).toEqual([
            buildDiffModels({ workspaceId: 'ws-1', relativePath: 'src/a.ts', stage: 'unstaged', original: 'one\ntwo\n', modified: 'one\nTWO\n' }),
        ]);
        expect(h.fake().models[0].modified).toMatchObject({ uri: 'coc-file://ws-1/src/a.ts', language: 'typescript', isWorkingCopy: true });
    });

    it('staged: both models are synthetic', async () => {
        const h = harness({ stage: 'staged' });
        await act(flush);
        const [models] = h.fake().models;
        expect(models.original.uri.startsWith('coc-diff-ref://')).toBe(true);
        expect(models.modified.uri.startsWith('coc-diff-ref://')).toBe(true);
        expect(models.modified.isWorkingCopy).toBe(false);
    });

    it('follows the app theme', async () => {
        appTheme = 'dark';
        const h = harness();
        await act(flush);
        expect(h.fake().adapter.setTheme).toHaveBeenLastCalledWith('vs-dark');
        appTheme = 'light';
        h.rerender({});
        expect(h.fake().adapter.setTheme).toHaveBeenLastCalledWith('vs');
    });
});

describe('MonacoFileDiffViewer — hunks and callbacks', () => {
    it('handle is not ready and reports zero hunks until the diff is computed', async () => {
        const h = harness();
        await act(flush);
        expect(h.ref.current!.isHunkNavigationReady()).toBe(false);
        expect(h.ref.current!.getHunkCount()).toBe(0);
        act(() => h.fake().finishDiff(TWO_HUNKS));
        expect(h.ref.current!.isHunkNavigationReady()).toBe(true);
        expect(h.ref.current!.getHunkCount()).toBe(2);
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(-1);
    });

    it('hunk commands move the cursor and reveal in the modified editor', async () => {
        const h = harness();
        await act(flush);
        act(() => h.fake().finishDiff(TWO_HUNKS));
        const reveal = h.fake().adapter.revealModifiedLine as ReturnType<typeof vi.fn>;
        h.ref.current!.scrollToNextHunk();
        h.ref.current!.scrollToNextHunk();
        expect(reveal.mock.calls.map(c => c[0])).toEqual([2, 9]);
        h.ref.current!.scrollToPrevHunk();
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(0);
        h.ref.current!.scrollToHunk(1);
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(1);
    });

    it('initialHunkTarget is applied when the diff finishes computing', async () => {
        const h = harness({ initialHunkTarget: 'last' });
        await act(flush);
        expect(h.fake().adapter.revealModifiedLine).not.toHaveBeenCalled();
        act(() => h.fake().finishDiff(TWO_HUNKS));
        expect(h.fake().adapter.revealModifiedLine).toHaveBeenCalledWith(9);
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(1);
    });

    it('reports line changes and the temporary DiffLine[] shim on every diff update', async () => {
        const onLineChanges = vi.fn();
        const onLinesReady = vi.fn();
        const h = harness({ onLineChanges, onLinesReady });
        await act(flush);
        act(() => h.fake().finishDiff([change(2, 2, 2, 2)]));
        expect(onLineChanges).toHaveBeenCalledWith([change(2, 2, 2, 2)]);
        const lines = onLinesReady.mock.calls[0][0];
        expect(lines.map((l: { type: string; content: string }) => [l.type, l.content])).toEqual([
            ['hunk-header', '@@ -1,2 +1,2 @@'],
            ['context', ' one'],
            ['removed', '-two'],
            ['added', '+TWO'],
        ]);
    });

    it('identical sides show "no changes", create no editor, and report no hunks', async () => {
        const onLinesReady = vi.fn();
        const h = harness({ original: 'same\n', modified: 'same\n', onLinesReady });
        await act(flush);
        expect(screen.getByTestId('monaco-file-diff-viewer-empty')).toBeTruthy();
        expect(h.createEditor).not.toHaveBeenCalled();
        expect(h.ref.current!.isHunkNavigationReady()).toBe(true);
        expect(h.ref.current!.getHunkCount()).toBe(0);
        expect(onLinesReady).toHaveBeenCalledWith([]);
    });

    it('reports editor creation failure', async () => {
        const onEditorError = vi.fn();
        harness({ createEditor: vi.fn(() => Promise.reject(new Error('no monaco'))), onEditorError });
        await act(flush);
        expect(onEditorError).toHaveBeenCalledWith(expect.objectContaining({ message: 'no monaco' }));
        expect(screen.queryByTestId('monaco-file-diff-viewer-loading')).toBeNull();
    });
});

describe('MonacoFileDiffViewer — lifecycle', () => {
    it('a file change swaps models on the same editor and resets the hunk cursor', async () => {
        const h = harness();
        await act(flush);
        act(() => h.fake().finishDiff(TWO_HUNKS));
        h.ref.current!.scrollToNextHunk();

        h.rerender({ relativePath: 'src/b.ts', original: 'x\n', modified: 'y\n' });
        expect(h.createEditor).toHaveBeenCalledTimes(1);
        expect(h.fake().models).toHaveLength(2);
        expect(h.fake().models[1].modified.uri).toBe('coc-file://ws-1/src/b.ts');
        expect(h.ref.current!.isHunkNavigationReady()).toBe(false);
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(-1);
    });

    it('a workspace change swaps to that workspace’s URIs (multi-repo)', async () => {
        const h = harness();
        await act(flush);
        h.rerender({ workspaceId: 'ws-2' });
        expect(h.fake().models[1].modified.uri).toBe('coc-file://ws-2/src/a.ts');
        expect(h.fake().models[1].original.uri).toContain('://ws-2/');
    });

    it('unmount disposes the editor and its diff listener exactly once', async () => {
        const h = harness();
        await act(flush);
        h.unmount();
        expect(h.fake().disposals).toBe(1);
        expect(h.fake().listenerDisposals).toBe(1);
    });

    it('unmount before the editor arrives disposes the late editor', async () => {
        const pending = deferred<ReturnType<typeof createFakeDiffEditor>['adapter']>();
        const fake = createFakeDiffEditor();
        const h = harness({ createEditor: vi.fn(() => pending.promise) });
        h.unmount();
        await act(async () => { pending.resolve(fake.adapter); await flush(); });
        expect(fake.disposals).toBe(1);
        expect(fake.models).toEqual([]);
    });

    it('a stale diff event from the previous file does not count as the new file’s hunks', async () => {
        const h = harness();
        await act(flush);
        h.rerender({ relativePath: 'src/b.ts', original: 'x\n', modified: 'y\n' });
        // Monaco fires, but the new pair has not produced a result yet.
        act(() => h.fake().fireDiff());
        expect(h.ref.current!.isHunkNavigationReady()).toBe(false);
        expect(h.ref.current!.getHunkCount()).toBe(0);
    });
});

describe('MonacoFileDiffViewer — cross-file navigation', () => {
    const FILES = ['/r/a.ts', '/r/b.ts', '/r/c.ts'];

    function navHarness(filePath: string, changes: DiffLineChange[] | null) {
        const h = harness();
        const onNavigateToFile = vi.fn();
        const nav = renderHook(() => {
            const viewerRef = useRef<MonacoFileDiffViewerHandle | null>(null);
            viewerRef.current = h.ref.current;
            return useCrossFileNav({ filePath, files: FILES, viewerRef: viewerRef as RefObject<MonacoFileDiffViewerHandle | null>, onNavigateToFile });
        });
        return { h, nav, onNavigateToFile, ready: () => { if (changes) act(() => h.fake().finishDiff(changes)); } };
    }

    it('▼ past the last hunk goes to the next file’s first hunk', async () => {
        const { h, nav, onNavigateToFile, ready } = navHarness('/r/a.ts', TWO_HUNKS);
        await act(flush);
        ready();
        nav.result.current.handleNext();
        nav.result.current.handleNext();
        expect(onNavigateToFile).not.toHaveBeenCalled();
        nav.result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenCalledWith('/r/b.ts', 'first');
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(1);
    });

    it('▲ before the first hunk goes to the previous file’s last hunk', async () => {
        const { nav, onNavigateToFile, ready } = navHarness('/r/b.ts', TWO_HUNKS);
        await act(flush);
        ready();
        nav.result.current.handlePrev(); // no cursor → last hunk
        nav.result.current.handlePrev(); // → hunk 0
        expect(onNavigateToFile).not.toHaveBeenCalled();
        nav.result.current.handlePrev();
        expect(onNavigateToFile).toHaveBeenCalledWith('/r/a.ts', 'last');
    });

    it('single-hunk file: ▼ then ▼ leaves; ▲ from its only hunk leaves backwards', async () => {
        const { nav, onNavigateToFile, ready } = navHarness('/r/c.ts', [change(3, 3, 3, 3)]);
        await act(flush);
        ready();
        nav.result.current.handleNext();
        expect(onNavigateToFile).not.toHaveBeenCalled();
        nav.result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenLastCalledWith('/r/a.ts', 'first');
        nav.result.current.handlePrev();
        expect(onNavigateToFile).toHaveBeenLastCalledWith('/r/b.ts', 'last');
    });

    it('navigation before the diff is computed stays in the file and lands once ready', async () => {
        const { h, nav, onNavigateToFile, ready } = navHarness('/r/a.ts', TWO_HUNKS);
        await act(flush);
        nav.result.current.handleNext();
        nav.result.current.handlePrev();
        expect(onNavigateToFile).not.toHaveBeenCalled();
        ready();
        // The latest held request (▲ from no cursor) applies: last hunk.
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(1);
    });

    it('arriving from the previous file with target "first" lands on hunk 0 once computed', async () => {
        const h = harness({ initialHunkTarget: 'first' });
        await act(flush);
        act(() => h.fake().finishDiff(TWO_HUNKS));
        expect(h.ref.current!.getCurrentHunkIndex()).toBe(0);
        expect(h.fake().adapter.revealModifiedLine).toHaveBeenCalledWith(2);
    });

    it('a file with no hunks moves on immediately once computed', async () => {
        const { nav, onNavigateToFile, ready } = navHarness('/r/a.ts', []);
        await act(flush);
        ready();
        nav.result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenCalledWith('/r/b.ts', 'first');
    });
});
