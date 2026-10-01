/**
 * AC-06 wiring: MonacoFileDiffViewer opens the working copy's language
 * document only for unstaged diffs, mounts providers on the real modified
 * model, forwards diagnostics as markers, shares the explorer's document, and
 * degrades to a plain read-only diff when the server is unavailable, refuses
 * capacity, the file is too large, or the explorer buffer has unsaved edits.
 * The editor is an owned adapter; the document store and provider code are real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
    MonacoFileDiffViewer,
    type MonacoFileDiffViewerProps,
} from '../../../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer';
import { isDiffRefUri } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';
import { DIFF_LANGUAGE_MAX_CHARS } from '../../../../../../src/server/spa/client/react/features/git/diff/diffLanguageEligibility';
import {
    LanguageDocumentStore,
    browserDocumentUri,
} from '../../../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { resetEditorNavigationForTests } from '../../../../../../src/server/spa/client/react/features/language-servers/editorNavigation';
import { FakeClient, readyState } from '../../../language-servers/fakeLanguageTransport';
import { createFakeDiffEditor, flush, type FakeDiffEditor } from './fakeDiffEditorAdapter';

vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

const URI = browserDocumentUri('ws-1', 'src/a.ts');
const DISK = 'const a = 1;\nconst b = 2;\n';

let client: FakeClient;
let store: LanguageDocumentStore;

beforeEach(() => {
    resetEditorNavigationForTests();
    client = new FakeClient();
    store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
});

function harness(overrides: Partial<MonacoFileDiffViewerProps> = {}) {
    const fakes: FakeDiffEditor[] = [];
    const createEditor = vi.fn(async (_host: HTMLElement, options) => {
        const fake = createFakeDiffEditor(options);
        fakes.push(fake);
        return fake.adapter;
    });
    const props: MonacoFileDiffViewerProps = {
        workspaceId: 'ws-1',
        relativePath: 'src/a.ts',
        stage: 'unstaged',
        original: 'const a = 0;\nconst b = 2;\n',
        modified: DISK,
        viewMode: 'unified',
        createEditor,
        languageStore: store,
        ...overrides,
    };
    const view = render(<MonacoFileDiffViewer {...props} />);
    const rerender = (next: Partial<MonacoFileDiffViewerProps>) => view.rerender(<MonacoFileDiffViewer {...props} {...next} />);
    return { ...view, rerender, createEditor, fake: () => fakes[0] };
}

const liveMounts = (fake: FakeDiffEditor) => fake.languageMounts.filter(m => m.live);

describe('MonacoFileDiffViewer — language features (AC-06)', () => {
    it('shares an eligible branch head with the explorer and releases only the diff reference', async () => {
        const explorer = store.open({ path: 'src/a.ts', text: DISK });
        const attachment = client.get('src/a.ts');
        act(() => attachment.attach());
        const h = harness({ stage: 'branch-range', modelIdentity: 'branch-range:upstream', modifiedMatchesWorkingCopy: true });
        await act(flush);
        expect(isDiffRefUri(h.fake().models[0].original.uri)).toBe(true);
        expect(liveMounts(h.fake())).toEqual([{ uri: URI, live: true }]);
        h.rerender({ stage: 'branch-range', modelIdentity: 'branch-range:upstream', modifiedMatchesWorkingCopy: false });
        await act(flush);
        expect(liveMounts(h.fake())).toEqual([]);
        expect(store.documentCount).toBe(1);
        expect(attachment.methods()).not.toContain('textDocument/didClose');
        h.unmount();
        expect(store.documentCount).toBe(1);
        explorer.close();
        expect(attachment.methods()).toContain('textDocument/didClose');
    });
    it('mounts language features on the real modified document of an unstaged diff', async () => {
        const h = harness();
        await act(flush);
        expect(store.documentCount).toBe(1);
        expect(store.peek('src/a.ts')?.text).toBe(DISK);
        expect(liveMounts(h.fake())).toEqual([{ uri: URI, live: true }]);
        expect(h.fake().adapter.attachModifiedLanguage).toHaveBeenCalledWith(URI, expect.any(Function));
    });

    it('both editor sides are constructed read-only', async () => {
        const h = harness();
        await act(flush);
        expect(h.createEditor.mock.calls[0][1]).toMatchObject({ readOnly: true, originalEditable: false, domReadOnly: true });
    });

    it('forwards diagnostics as markers on the modified document and clears them', async () => {
        const h = harness();
        await act(flush);
        const attachment = client.get('src/a.ts');
        act(() => attachment.attach({ state: readyState({ textDocumentSync: 1, hoverProvider: true }) }));
        act(() => attachment.notify('textDocument/publishDiagnostics', {
            uri: URI,
            diagnostics: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, message: 'unused', severity: 2 }],
        }));
        expect(h.fake().markerLog.at(-1)).toEqual({ uri: URI, count: 1 });
        act(() => attachment.notify('textDocument/publishDiagnostics', { uri: URI, diagnostics: [] }));
        expect(h.fake().markerLog.at(-1)).toEqual({ uri: URI, count: 0 });
    });

    it('never opens a document or mounts anything for a staged diff', async () => {
        const h = harness({ stage: 'staged' });
        await act(flush);
        expect(store.documentCount).toBe(0);
        expect(h.fake().adapter.attachModifiedLanguage).not.toHaveBeenCalled();
        expect(h.fake().markerLog).toEqual([]);
        expect(screen.getByTestId('monaco-file-diff-viewer-host')).toBeTruthy();
    });

    it('never asks the adapter to mount a synthetic URI', async () => {
        const h = harness();
        await act(flush);
        h.rerender({ stage: 'staged' });
        await act(flush);
        h.rerender({ stage: 'unstaged', modified: `${DISK}// more\n` });
        await act(flush);
        const calls = vi.mocked(h.fake().adapter.attachModifiedLanguage).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [uri] of calls) expect(isDiffRefUri(uri)).toBe(false);
        for (const [uri] of vi.mocked(h.fake().adapter.setModifiedMarkers).mock.calls) expect(isDiffRefUri(uri)).toBe(false);
    });

    it('switching the same file to staged drops the mount and the document', async () => {
        const h = harness();
        await act(flush);
        h.rerender({ stage: 'staged' });
        await act(flush);
        expect(liveMounts(h.fake())).toEqual([]);
        expect(store.documentCount).toBe(0);
        expect(client.get('src/a.ts').released).toBe(true);
    });

    it('re-mounts on the new model after a swap and drops the old mount first', async () => {
        const h = harness();
        await act(flush);
        h.rerender({ modified: `${DISK}const c = 3;\n` });
        await act(flush);
        const mounts = h.fake().languageMounts;
        expect(mounts.length).toBe(2);
        expect(mounts[0].live).toBe(false);
        expect(mounts[1].live).toBe(true);
        expect(store.peek('src/a.ts')?.text).toBe(`${DISK}const c = 3;\n`);
    });

    it('closing the diff does not close a document the explorer still has open', async () => {
        const explorer = store.open({ path: 'src/a.ts', text: DISK });
        const attachment = client.get('src/a.ts');
        act(() => attachment.attach());
        const h = harness();
        await act(flush);
        expect(store.documentCount).toBe(1);
        expect(liveMounts(h.fake())).toHaveLength(1);

        h.unmount();
        expect(store.documentCount).toBe(1);
        expect(attachment.methods()).not.toContain('textDocument/didClose');
        expect(explorer.getText()).toBe(DISK);

        explorer.close();
        expect(store.documentCount).toBe(0);
        expect(attachment.methods()).toContain('textDocument/didClose');
    });

    it('closing the diff closes a document only the diff held, and unmounts providers', async () => {
        const h = harness();
        await act(flush);
        const fake = h.fake();
        const attachment = client.get('src/a.ts');
        act(() => attachment.attach());
        h.unmount();
        expect(liveMounts(fake)).toEqual([]);
        expect(store.documentCount).toBe(0);
        expect(attachment.methods()).toContain('textDocument/didClose');
    });

    it('an unsaved explorer edit turns features off instead of misplacing them', async () => {
        const explorer = store.open({ path: 'src/a.ts', text: DISK });
        const h = harness();
        await act(flush);
        expect(liveMounts(h.fake())).toHaveLength(1);

        act(() => explorer.update(`// typed\n${DISK}`));
        await act(flush);
        expect(liveMounts(h.fake())).toEqual([]);
        // The diff does not overwrite the unsaved buffer with disk text.
        expect(explorer.getText()).toBe(`// typed\n${DISK}`);

        act(() => explorer.update(DISK));
        await act(flush);
        expect(liveMounts(h.fake())).toHaveLength(1);
        explorer.close();
    });

    it.each([
        ['capacity', 'Language servers busy'],
        ['no-server', 'No language server for this file'],
    ])('a refused session (%s) degrades to a plain diff', async (reason, detail) => {
        const h = harness();
        await act(flush);
        const attachment = client.get('src/a.ts');
        act(() => attachment.attach({ state: readyState({ textDocumentSync: 1 }) }));
        act(() => attachment.notify('textDocument/publishDiagnostics', {
            uri: URI,
            diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'x' }],
        }));
        expect(h.fake().markerLog.at(-1)).toEqual({ uri: URI, count: 1 });

        act(() => attachment.reportUnavailable(reason, detail));
        await act(flush);
        expect(liveMounts(h.fake())).toEqual([]);
        expect(h.fake().markerLog.at(-1)).toEqual({ uri: URI, count: 0 });
        expect(screen.getByTestId('monaco-file-diff-viewer-host')).toBeTruthy();
        expect(screen.queryByTestId('monaco-file-diff-viewer-loading')).toBeNull();
    });

    it('a server that never starts leaves the diff usable and does not throw', async () => {
        const h = harness();
        await act(flush);
        // No attach: status stays detached; providers are registered optimistically
        // and answer empty, the diff renders normally.
        expect(store.peek('src/a.ts')?.status).toBe('detached');
        expect(screen.getByTestId('monaco-file-diff-viewer-host')).toBeTruthy();
        h.unmount();
    });

    it('files above the explorer threshold get no language document', async () => {
        const big = 'x'.repeat(DIFF_LANGUAGE_MAX_CHARS + 1);
        const h = harness({ modified: big });
        await act(flush);
        expect(store.documentCount).toBe(0);
        expect(h.fake().adapter.attachModifiedLanguage).not.toHaveBeenCalled();
    });

    it('languageFeatures={false} opens nothing', async () => {
        const h = harness({ languageFeatures: false });
        await act(flush);
        expect(store.documentCount).toBe(0);
        expect(h.fake().adapter.attachModifiedLanguage).not.toHaveBeenCalled();
    });

    it('identical sides open no document', async () => {
        harness({ original: DISK, modified: DISK });
        await act(flush);
        expect(store.documentCount).toBe(0);
    });

    it('keeps two workspaces apart', async () => {
        const client2 = new FakeClient('ws-2');
        const store2 = new LanguageDocumentStore({ workspaceId: 'ws-2', client: client2.asClient() });
        const a = harness();
        const b = harness({ workspaceId: 'ws-2', languageStore: store2 });
        await act(flush);
        expect(store.documentCount).toBe(1);
        expect(store2.documentCount).toBe(1);
        expect(liveMounts(a.fake())[0].uri).toBe(URI);
        expect(liveMounts(b.fake())[0].uri).toBe(browserDocumentUri('ws-2', 'src/a.ts'));
    });
});
