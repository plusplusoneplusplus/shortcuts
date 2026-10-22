import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDiffCurrentCodeModel } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCurrentCodeMount';
import { DIFF_LANGUAGE_MAX_CHARS } from '../../../../../../src/server/spa/client/react/features/git/diff/diffLanguageEligibility';
import { installLanguageEditorOpener, resetEditorNavigationForTests } from '../../../../../../src/server/spa/client/react/features/language-servers/editorNavigation';

const URI = 'coc-diff-ref://ws-1/commit/original/src/a.ts';
const position = { lineNumber: 2, column: 4 };
const targets = [
    { workspaceId: 'ws-1', path: 'src/b.ts', line: 8, column: 3, symbolCandidate: true as const },
    { workspaceId: 'ws-1', path: 'src/c.ts', line: 12, column: 1, symbolCandidate: true as const },
];
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    resetEditorNavigationForTests();
});

function setup(uri = URI, size = 30) {
    const providers: Record<string, any> = {};
    const disposed: string[] = [];
    const register = (kind: string) => (_language: string, provider: unknown) => {
        providers[kind] = provider;
        return { dispose: () => disposed.push(kind) };
    };
    const lookup = vi.fn().mockResolvedValue(targets);
    const definitions = { lookup, dispose: vi.fn() };
    const loadSource = vi.fn().mockResolvedValue('function target() {}');
    const onNavigate = vi.fn(() => true);
    const model = {
        uri: { toString: () => uri },
        getValueLength: () => size,
        getLanguageId: () => 'typescript',
        getWordAtPosition: vi.fn(() => ({ word: 'target', startColumn: 1, endColumn: 7 })),
    };
    const previews = new Map<string, any>();
    let opener: any;
    const monaco = {
        Uri: { parse: (value: string) => ({ toString: () => value }) },
        languages: { registerDefinitionProvider: register('definition'), registerHoverProvider: register('hover') },
        editor: {
            getModel: (uri: any) => previews.get(uri.toString()) ?? null,
            createModel: (text: string, _language: string, uri: any) => {
                const preview = { uri, setValue: vi.fn(), dispose: vi.fn() };
                previews.set(uri.toString(), preview);
                return preview;
            },
            registerEditorOpener: (value: any) => { opener = value; return { dispose() {} }; },
        },
    };
    const subscribe = () => ({ dispose: vi.fn() });
    const editor = {
        createDecorationsCollection: () => ({ clear() {}, set() {} }),
        onDidChangeModelContent: subscribe, onDidScrollChange: subscribe,
        onKeyDown: subscribe, onKeyUp: subscribe, onMouseLeave: subscribe, onMouseMove: subscribe,
    };
    const cleanup = mountDiffCurrentCodeModel({
        model, editor, monaco, workspaceId: 'ws-1', definitions, loadSource, onNavigate,
    } as any);
    cleanups.push(cleanup);
    let cancel = () => {};
    const unsubscribe = vi.fn();
    const token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: () => void) => {
            cancel = listener;
            return { dispose: unsubscribe };
        },
    };
    return { providers, disposed, definitions, lookup, loadSource, model, previews, monaco,
        onNavigate, cleanup, token, cancel: () => cancel(), unsubscribe, opener: () => opener };
}

describe('historical diff definition mount', () => {
    it.each(['original', 'modified'])('looks up an %s-side word and prepares every candidate for Monaco Peek', async side => {
        const s = setup(URI.replace('/original/', `/${side}/`));
        const result = await s.providers.definition.provideDefinition(s.model, position, s.token);
        expect(s.lookup).toHaveBeenCalledWith('target', expect.any(AbortSignal));
        expect(result.map((location: any) => [location.uri.toString(), location.range.startLineNumber])).toEqual([
            ['coc-file://ws-1/src/b.ts#symbol-index-candidate', 8],
            ['coc-file://ws-1/src/c.ts#symbol-index-candidate', 12],
        ]);
        expect(s.loadSource.mock.calls.map(call => call[0])).toEqual(['src/b.ts', 'src/c.ts']);
        expect(s.previews.size).toBe(2);
        expect(s.unsubscribe).toHaveBeenCalledOnce();
    });

    it('answers only for its own model and only definitions and hover', async () => {
        const s = setup();
        expect(Object.keys(s.providers)).toEqual(['definition', 'hover']);
        const other = { ...s.model };
        expect(await s.providers.definition.provideDefinition(other, position, s.token)).toBeNull();
        expect(await s.providers.hover.provideHover(other, position, s.token)).toBeNull();
        expect(s.lookup).not.toHaveBeenCalled();
    });

    it('labels only resolved words as current code and rejects foreign results', async () => {
        const s = setup();
        expect(await s.providers.hover.provideHover(s.model, position, s.token)).toEqual({
            contents: [{ value: 'Definition lookup: **current code**' }],
        });
        s.lookup.mockResolvedValue([{ ...targets[0], workspaceId: 'ws-2' }]);
        expect(await s.providers.hover.provideHover(s.model, position, s.token)).toBeNull();
        expect(await s.providers.definition.provideDefinition(s.model, position, s.token)).toEqual([]);
    });

    it.each(['cancellation', 'disposal'])('suppresses delayed results on %s', async outcome => {
        const s = setup();
        let finish!: (value: typeof targets) => void;
        s.lookup.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const result = s.providers.definition.provideDefinition(s.model, position, s.token);
        if (outcome === 'cancellation') s.cancel(); else s.cleanup();
        expect(s.lookup.mock.calls[0][1].aborted).toBe(true);
        finish(targets);
        expect(await result).toBeNull();
        expect(s.loadSource).not.toHaveBeenCalled();
    });

    it('declines already-cancelled calls without a lookup', async () => {
        const s = setup();
        s.token.isCancellationRequested = true;
        expect(await s.providers.definition.provideDefinition(s.model, position, s.token)).toBeNull();
        expect(s.lookup).not.toHaveBeenCalled();
    });

    it('returns no result for whitespace and failed lookups', async () => {
        const s = setup();
        s.model.getWordAtPosition.mockReturnValueOnce(null as any);
        expect(await s.providers.definition.provideDefinition(s.model, position, s.token)).toEqual([]);
        expect(s.lookup).not.toHaveBeenCalled();
        s.lookup.mockRejectedValue(new Error('offline'));
        expect(await s.providers.definition.provideDefinition(s.model, position, s.token)).toBeNull();
        expect(s.unsubscribe).toHaveBeenCalledTimes(2);
    });

    it('routes candidate navigation only to the owning workspace and disposes once', async () => {
        const s = setup();
        installLanguageEditorOpener(s.monaco as any);
        const source = { getModel: () => s.model };
        const resource = s.monaco.Uri.parse('coc-file://ws-1/src/b.ts#symbol-index-candidate');
        expect(s.opener().openCodeEditor(source, resource, position)).toBe(true);
        expect(s.onNavigate).toHaveBeenCalledWith({ ...targets[0], line: 2, column: 4 });
        expect(s.opener().openCodeEditor(source, s.monaco.Uri.parse('coc-file://ws-2/src/b.ts'), position)).toBe(false);
        await s.providers.definition.provideDefinition(s.model, position, s.token);
        s.cleanup(); s.cleanup();
        expect(s.definitions.dispose).toHaveBeenCalledOnce();
        expect(s.disposed).toEqual(['hover', 'definition']);
        expect([...s.previews.values()].every(model => model.dispose.mock.calls.length === 1)).toBe(true);
        expect(s.opener().openCodeEditor(source, resource, position)).toBe(false);
    });

    it.each([
        ['coc-file://ws-1/src/a.ts', 30],
        ['coc-diff-ref://ws-2/commit/original/src/a.ts', 30],
        [URI, DIFF_LANGUAGE_MAX_CHARS + 1],
    ])('does not mount on live or oversized models (%s)', (uri, size) => {
        const s = setup(uri, size);
        expect(s.providers).toEqual({});
        expect(s.lookup).not.toHaveBeenCalled();
    });
});
