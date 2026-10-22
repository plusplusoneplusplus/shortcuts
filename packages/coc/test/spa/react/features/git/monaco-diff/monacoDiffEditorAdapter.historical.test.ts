/**
 * The real adapter's historical mount seam: definition-only features attach
 * per side to `coc-diff-ref:` snapshots only, never to the working-copy
 * document, and are undone on model swap and dispose.
 */

import { describe, it, expect, vi } from 'vitest';
import type * as MonacoApi from 'monaco-editor';
import { createMonacoDiffEditorAdapter } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffEditorAdapter';
import { buildDiffModels } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';

vi.mock('@monaco-editor/react', () => ({ loader: { init: vi.fn() } }));

function fakeMonaco() {
    const models = new Map<string, { uri: { scheme: string; toString: () => string }; getValue: () => string; dispose: () => void }>();
    const parse = (value: string) => ({ scheme: value.slice(0, value.indexOf(':')), toString: () => value });
    const sideEditor = () => {
        let model: unknown = null;
        return {
            getModel: () => model,
            setModelForTest: (next: unknown) => { model = next; },
            createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
            changeViewZones: () => {},
            removeGlyphMarginWidget: () => {},
        };
    };
    const original = sideEditor();
    const modified = sideEditor();
    const diffEditor = {
        getOriginalEditor: () => original,
        getModifiedEditor: () => modified,
        setModel: (pair: { original: unknown; modified: unknown } | null) => {
            original.setModelForTest(pair?.original ?? null);
            modified.setModelForTest(pair?.modified ?? null);
        },
        dispose: () => {},
    };
    const monaco = {
        Uri: { parse },
        editor: {
            createDiffEditor: () => diffEditor,
            getModel: (uri: { toString: () => string }) => models.get(uri.toString()) ?? null,
            createModel: (text: string, _language: string, uri: { scheme: string; toString: () => string }) => {
                const model = { uri, getValue: () => text, dispose: () => { models.delete(uri.toString()); } };
                models.set(uri.toString(), model);
                return model;
            },
        },
    };
    return { monaco: monaco as unknown as typeof MonacoApi, original, modified };
}

const COMMIT = buildDiffModels({
    workspaceId: 'ws-1', relativePath: 'src/a.ts', stage: 'staged', modelIdentity: 'commit:abc',
    original: 'old\n', modified: 'new\n',
});
const UNSTAGED = buildDiffModels({
    workspaceId: 'ws-1', relativePath: 'src/a.ts', stage: 'unstaged', original: 'index\n', modified: 'disk\n',
});

describe('monacoDiffEditorAdapter — historical language mounts', () => {
    it('mounts on both ref-backed sides with that side editor and model', () => {
        const { monaco, original, modified } = fakeMonaco();
        const adapter = createMonacoDiffEditorAdapter(monaco, document.createElement('div'), {});
        adapter.setModels(COMMIT);
        const contexts: { editor: unknown; uri: string }[] = [];
        const mount = vi.fn((context: { editor: unknown; model: { uri: { toString(): string } } }) => {
            contexts.push({ editor: context.editor, uri: context.model.uri.toString() });
        });
        expect(adapter.attachHistoricalLanguage!('original', mount as never)).not.toBeNull();
        expect(adapter.attachHistoricalLanguage!('modified', mount as never)).not.toBeNull();
        expect(contexts).toEqual([
            { editor: original, uri: COMMIT.original.uri },
            { editor: modified, uri: COMMIT.modified.uri },
        ]);
    });

    it('refuses the working-copy document but serves its ref-backed original', () => {
        const { monaco } = fakeMonaco();
        const adapter = createMonacoDiffEditorAdapter(monaco, document.createElement('div'), {});
        adapter.setModels(UNSTAGED);
        const mount = vi.fn();
        expect(adapter.attachHistoricalLanguage!('modified', mount)).toBeNull();
        expect(mount).not.toHaveBeenCalled();
        expect(adapter.attachHistoricalLanguage!('original', mount)).not.toBeNull();
        expect(mount).toHaveBeenCalledTimes(1);
    });

    it('undoes mounts on model swap, re-attach, explicit dispose and editor dispose', () => {
        const { monaco } = fakeMonaco();
        const adapter = createMonacoDiffEditorAdapter(monaco, document.createElement('div'), {});
        adapter.setModels(COMMIT);
        const cleanups = { original: vi.fn(), modified: vi.fn() };
        adapter.attachHistoricalLanguage!('original', () => cleanups.original);
        const modified = adapter.attachHistoricalLanguage!('modified', () => cleanups.modified)!;
        adapter.setModels(UNSTAGED);
        expect(cleanups.original).toHaveBeenCalledTimes(1);
        expect(cleanups.modified).toHaveBeenCalledTimes(1);
        modified.dispose();
        expect(cleanups.modified).toHaveBeenCalledTimes(1);

        const first = vi.fn();
        const second = vi.fn();
        const stale = adapter.attachHistoricalLanguage!('original', () => first)!;
        adapter.attachHistoricalLanguage!('original', () => second);
        expect(first).toHaveBeenCalledTimes(1);
        stale.dispose();
        expect(second).not.toHaveBeenCalled();
        adapter.dispose();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
