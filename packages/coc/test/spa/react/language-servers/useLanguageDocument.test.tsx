/**
 * `useLanguageDocument` over a real store and a faked transport.
 *
 * The hook is the seam a file viewer will use, so the cases here are the ones a
 * viewer can actually hit: opting out, opening and replaying, sharing one
 * buffer between two mounted views, refusing disk text over unsaved edits, and
 * releasing the document when the component unmounts.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LanguageDocumentStore } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { useLanguageDocument } from '../../../../src/server/spa/client/react/features/language-servers/useLanguageDocument';
import { MONACO_MARKER_SEVERITY } from '../../../../src/server/spa/client/react/features/language-servers/monacoBridge';
import { FakeClient } from './fakeLanguageTransport';

describe('useLanguageDocument', () => {
    let client: FakeClient;
    let store: LanguageDocumentStore;

    beforeEach(() => {
        client = new FakeClient();
        store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
    });

    function render(props: { path?: string | null; enabled?: boolean; text?: string } = {}) {
        return renderHook(
            (current: { path?: string | null; enabled?: boolean; text?: string }) =>
                useLanguageDocument({
                    workspaceId: 'ws-1',
                    path: current.path === undefined ? 'src/a.ts' : current.path,
                    enabled: current.enabled,
                    text: current.text ?? 'const a = 1;',
                    fallbackLanguageId: 'typescript',
                    store,
                }),
            { initialProps: props },
        );
    }

    it('opens the document and reports the buffer once the host attaches', () => {
        const { result } = render();
        expect(store.documentCount).toBe(1);
        expect(result.current.status).toBe('detached');
        expect(result.current.ready).toBe(false);

        act(() => client.get('src/a.ts').attach());

        expect(result.current.status).toBe('ready');
        expect(result.current.ready).toBe(true);
        expect(client.get('src/a.ts').methods()).toEqual(['textDocument/didOpen']);
        expect(result.current.view?.getText()).toBe('const a = 1;');
    });

    it('touches nothing when the host opts out', () => {
        const { result } = render({ enabled: false });
        expect(store.documentCount).toBe(0);
        expect(result.current.view).toBeNull();
        expect(result.current.status).toBe('detached');
        // A viewer still calls the callbacks; they must be harmless.
        act(() => result.current.handleChange('edited'));
        act(() => result.current.markSaved());
    });

    it('touches nothing without a path', () => {
        const { result } = render({ path: null });
        expect(store.documentCount).toBe(0);
        expect(result.current.view).toBeNull();
    });

    it('forwards an edit as an incremental change when the server negotiated one', () => {
        const { result } = render();
        act(() => client.get('src/a.ts').attach({ state: incrementalState() }));

        act(() =>
            result.current.handleChange('const b = 1;', [
                { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, text: 'b' },
            ]),
        );

        const change = client.get('src/a.ts').lastOf('textDocument/didChange');
        expect(change?.contentChanges).toEqual([
            { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, text: 'b' },
        ]);
    });

    it('exposes diagnostics as Monaco markers on the one-based range', () => {
        const { result } = render();
        const attachment = client.get('src/a.ts');
        act(() => attachment.attach());

        act(() =>
            attachment.notify('textDocument/publishDiagnostics', {
                uri: result.current.view!.uri,
                diagnostics: [
                    {
                        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
                        message: 'oops',
                        severity: 2,
                    },
                ],
            }),
        );

        expect(result.current.diagnostics).toHaveLength(1);
        expect(result.current.markers).toEqual([
            {
                severity: MONACO_MARKER_SEVERITY.warning,
                message: 'oops',
                source: undefined,
                code: undefined,
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 2,
                endColumn: 6,
            },
        ]);
    });

    it('shares one buffer between two mounted views and keeps it until both unmount', () => {
        const first = render();
        const second = render();
        expect(store.documentCount).toBe(1);

        act(() => client.get('src/a.ts').attach());
        act(() => first.result.current.handleChange('edited by the first view'));

        expect(second.result.current.view?.getText()).toBe('edited by the first view');

        first.unmount();
        expect(store.documentCount).toBe(1);
        expect(client.get('src/a.ts').methods()).not.toContain('textDocument/didClose');

        second.unmount();
        expect(store.documentCount).toBe(0);
        expect(client.get('src/a.ts').methods()).toContain('textDocument/didClose');
        expect(client.get('src/a.ts').released).toBe(true);
    });

    it('accepts new disk text on a clean buffer and refuses it on a dirty one', () => {
        const clean = render({ text: 'first' });
        act(() => client.get('src/a.ts').attach());
        act(() => clean.rerender({ text: 'second' }));
        expect(clean.result.current.view?.getText()).toBe('second');

        act(() => clean.result.current.handleChange('unsaved work'));
        act(() => clean.rerender({ text: 'third' }));
        expect(clean.result.current.view?.getText()).toBe('unsaved work');
    });

    it('does not reopen the document when the text prop changes', () => {
        const { result, rerender } = render({ text: 'first' });
        const attachment = client.get('src/a.ts');
        act(() => attachment.attach());
        const openedOnce = attachment.methods().filter((method) => method === 'textDocument/didOpen').length;

        act(() => rerender({ text: 'second' }));

        expect(attachment.methods().filter((method) => method === 'textDocument/didOpen')).toHaveLength(openedOnce);
        expect(result.current.view?.getVersion()).toBeGreaterThan(0);
    });

    it('sends didSave only after the host reports the write succeeded', () => {
        const { result } = render();
        act(() => client.get('src/a.ts').attach());
        act(() => result.current.handleChange('edited'));
        expect(client.get('src/a.ts').methods()).not.toContain('textDocument/didSave');

        act(() => result.current.markSaved('edited'));

        expect(client.get('src/a.ts').methods()).toContain('textDocument/didSave');
        expect(result.current.view?.isDirty()).toBe(false);
    });

    it('closes the old document and opens the new one when the path changes', () => {
        const { rerender } = render({ text: 'a' });
        act(() => client.get('src/a.ts').attach());

        act(() => rerender({ path: 'src/b.ts', text: 'b' }));

        expect(store.documentCount).toBe(1);
        expect(store.peek('src/b.ts')?.text).toBe('b');
        expect(store.peek('src/a.ts')).toBeNull();
        expect(client.get('src/a.ts').released).toBe(true);
    });

    it('keeps the document editable when the host reports language support unavailable', () => {
        const { result } = render();
        act(() => client.get('src/a.ts').reportUnavailable('disabled', 'Language support is off'));

        expect(result.current.status).toBe('unavailable');
        expect(result.current.ready).toBe(false);
        act(() => result.current.handleChange('still typing'));
        expect(result.current.view?.getText()).toBe('still typing');
    });
});

function incrementalState() {
    return {
        status: 'ready' as const,
        definitionId: 'typescript',
        displayName: 'TypeScript',
        capabilities: { textDocumentSync: 2 },
    };
}
