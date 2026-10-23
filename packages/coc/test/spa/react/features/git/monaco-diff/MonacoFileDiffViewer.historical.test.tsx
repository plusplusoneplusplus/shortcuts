/**
 * Historical definition wiring: with `historicalDefinitions`, MonacoFileDiffViewer
 * mounts best-effort current-code providers on each ref-backed side only, keeps
 * the working-copy document on the full language path, re-mounts after model
 * swaps, scopes lookups to the diff's workspace and clone route, and reports the
 * initiating side when a jump leaves the file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { ToastProvider } from '../../../../../../src/server/spa/client/react/contexts/ToastContext';
import {
    MonacoFileDiffViewer,
    type MonacoFileDiffViewerProps,
} from '../../../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer';
import { LanguageDocumentStore, browserDocumentUri } from '../../../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { resetEditorNavigationForTests } from '../../../../../../src/server/spa/client/react/features/language-servers/editorNavigation';
import { FakeClient } from '../../../language-servers/fakeLanguageTransport';
import { createFakeDiffEditor, flush, type FakeDiffEditor } from './fakeDiffEditorAdapter';

const mountFailure = vi.hoisted(() => ({ throws: false }));
const mountCalls = vi.hoisted(() => [] as { uri: string; workspaceId: string; routingRef: unknown; onNavigate?: (target: unknown) => unknown; onNoDefinition?: (word: string) => void; cleanup: ReturnType<typeof import('vitest').vi.fn> }[]);

vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/diffCurrentCodeMount', async () => {
    const { vi: mockVi } = await import('vitest');
    return {
        mountDiffCurrentCodeModel: (options: { model: { uri: { toString(): string } }; workspaceId: string; routingRef: unknown; onNavigate?: (target: unknown) => unknown; onNoDefinition?: (word: string) => void }) => {
            if (mountFailure.throws) throw new Error('language client unavailable');
            const cleanup = mockVi.fn();
            mountCalls.push({ uri: options.model.uri.toString(), workspaceId: options.workspaceId, routingRef: options.routingRef, onNavigate: options.onNavigate, onNoDefinition: options.onNoDefinition, cleanup });
            return cleanup;
        },
    };
});

vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

let client: FakeClient;
let store: LanguageDocumentStore;

beforeEach(() => {
    mountCalls.length = 0;
    mountFailure.throws = false;
    resetEditorNavigationForTests();
    client = new FakeClient();
    store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
});

function harness(overrides: Partial<MonacoFileDiffViewerProps> = {}, addToast?: (message: string, type?: string) => void) {
    const fakes: FakeDiffEditor[] = [];
    const createEditor = vi.fn(async (_host: HTMLElement, options) => {
        const fake = createFakeDiffEditor(options);
        fakes.push(fake);
        return fake.adapter;
    });
    const props: MonacoFileDiffViewerProps = {
        workspaceId: 'ws-1',
        relativePath: 'src/a.ts',
        stage: 'staged',
        modelIdentity: 'commit:abc',
        original: 'const a = 0;\n',
        modified: 'const a = 1;\n',
        viewMode: 'split',
        createEditor,
        languageStore: store,
        historicalDefinitions: true,
        ...overrides,
    };
    const wrap = (node: JSX.Element) => addToast
        ? <ToastProvider value={{ addToast, removeToast: () => {}, toasts: [] }}>{node}</ToastProvider>
        : node;
    const view = render(wrap(<MonacoFileDiffViewer {...props} />));
    const rerender = (next: Partial<MonacoFileDiffViewerProps>) => view.rerender(wrap(<MonacoFileDiffViewer {...props} {...next} />));
    return { ...view, rerender, fake: () => fakes[0] };
}

const live = (fake: FakeDiffEditor) => fake.historicalMounts.filter(m => m.live).map(m => m.side);

describe('MonacoFileDiffViewer — historical definitions', () => {
    it('mounts on both sides of a commit snapshot, scoped to its workspace and route', async () => {
        const h = harness({ routingRef: 'remote:srv:ws-1' });
        await act(flush);
        expect(live(h.fake())).toEqual(['original', 'modified']);
        expect(mountCalls.map(call => [call.workspaceId, call.routingRef])).toEqual([
            ['ws-1', 'remote:srv:ws-1'],
            ['ws-1', 'remote:srv:ws-1'],
        ]);
        expect(mountCalls.every(call => call.uri.startsWith('coc-diff-ref://ws-1/'))).toBe(true);
        expect(h.fake().languageMounts).toEqual([]);
    });

    it('serves only the left side of an unstaged diff; the working copy keeps the full path', async () => {
        const h = harness({ stage: 'unstaged', modelIdentity: undefined });
        await act(flush);
        expect(live(h.fake())).toEqual(['original']);
        expect(mountCalls.map(call => call.uri)).toEqual([h.fake().models[0].original.uri]);
        expect(mountCalls.some(call => call.uri === browserDocumentUri('ws-1', 'src/a.ts'))).toBe(false);
    });

    it('serves both sides of a staged diff whose index differs from disk', async () => {
        const h = harness({ modelIdentity: undefined });
        await act(flush);
        expect(live(h.fake())).toEqual(['original', 'modified']);
    });

    it('keeps a server-confirmed branch head on the full path and its base on best-effort', async () => {
        const h = harness({ stage: 'branch-range', modelIdentity: 'branch-range:upstream', modifiedMatchesWorkingCopy: true });
        await act(flush);
        expect(live(h.fake())).toEqual(['original']);
    });

    it('does not mount without the opt-in (PR hosts)', async () => {
        const h = harness({ historicalDefinitions: false });
        await act(flush);
        expect(h.fake().historicalMounts).toEqual([]);
        expect(mountCalls).toEqual([]);
    });

    it('re-mounts after a model swap and cleans up on opt-out and unmount', async () => {
        const h = harness();
        await act(flush);
        const first = [...mountCalls];
        h.rerender({ modelIdentity: 'commit:def' });
        await act(flush);
        expect(first.every(call => call.cleanup.mock.calls.length === 1)).toBe(true);
        expect(live(h.fake())).toEqual(['original', 'modified']);
        expect(mountCalls.slice(2).every(call => call.uri.includes('commit%3Adef'))).toBe(true);
        h.rerender({ modelIdentity: 'commit:def', historicalDefinitions: false });
        await act(flush);
        expect(live(h.fake())).toEqual([]);
        h.unmount();
        expect(mountCalls.every(call => call.cleanup.mock.calls.length === 1)).toBe(true);
    });

    it('forwards jumps with the initiating side and declines when the host has no handler', async () => {
        const onNavigateDefinition = vi.fn(() => true);
        const h = harness({ onNavigateDefinition });
        await act(flush);
        const target = { workspaceId: 'ws-1', path: 'src/b.ts', line: 3, column: 1 };
        expect(mountCalls[0].onNavigate?.(target)).toBe(true);
        expect(mountCalls[1].onNavigate?.(target)).toBe(true);
        expect(onNavigateDefinition.mock.calls).toEqual([[target, 'original'], [target, 'modified']]);
        h.rerender({ onNavigateDefinition: undefined });
        expect(mountCalls[0].onNavigate?.(target)).toBe(false);
    });

    it('keeps a plain diff when the lookup cannot start', async () => {
        mountFailure.throws = true;
        const h = harness();
        await act(flush);
        expect(h.getByTestId('monaco-file-diff-viewer')).toBeTruthy();
        expect(h.fake().historicalMounts.map(m => m.side)).toEqual(['original', 'modified']);
        h.unmount();
        expect(h.fake().historicalMounts.every(m => !m.live)).toBe(true);
    });

    it('toasts "No definition found" for an empty click on either side, or defers to the host', async () => {
        const addToast = vi.fn();
        const h = harness({}, addToast);
        await act(flush);
        mountCalls[0].onNoDefinition?.('parse');
        mountCalls[1].onNoDefinition?.('render');
        expect(addToast.mock.calls).toEqual([
            ["No definition found for 'parse'", 'info'],
            ["No definition found for 'render'", 'info'],
        ]);
        const onNoDefinition = vi.fn();
        h.rerender({ onNoDefinition });
        mountCalls[0].onNoDefinition?.('parse');
        expect(onNoDefinition).toHaveBeenCalledWith('parse');
        expect(addToast).toHaveBeenCalledTimes(2);
    });

    it('stays quiet without a toast provider', async () => {
        harness();
        await act(flush);
        expect(() => mountCalls[0].onNoDefinition?.('parse')).not.toThrow();
    });
});
