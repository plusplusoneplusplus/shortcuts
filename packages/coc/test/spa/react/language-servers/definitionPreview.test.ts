import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDocumentUri } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    registerDefinitionPreviewSource,
    type DefinitionPreviewModel,
    type DefinitionPreviewUri,
} from '../../../../src/server/spa/client/react/features/language-servers/definitionPreview';
import { externalResourceUri } from '../../../../src/server/spa/client/react/features/language-servers/externalSource';
import {
    readExternalSourceRecord,
    resetExternalSourceStoreForTests,
} from '../../../../src/server/spa/client/react/features/language-servers/externalSourceStore';

function createMonaco() {
    const models = new Map<string, DefinitionPreviewModel>();
    const attachmentListeners = new Map<string, () => void>();
    const attached = new Set<string>();
    const disposed = new Set<string>();
    const monaco = {
        editor: {
            getModel: (resource: DefinitionPreviewUri) => models.get(resource.toString()) ?? null,
            setModelLanguage: (model: { language: string }, languageId: string) => {
                model.language = languageId;
            },
            createModel: (content: string, language: string | undefined, resource: DefinitionPreviewUri) => {
                const key = resource.toString();
                const model = {
                    uri: resource,
                    content,
                    language: language ?? 'plaintext',
                    getLanguageId: () => model.language,
                    setValue: (value: string) => { model.content = value; },
                    isAttachedToEditor: () => attached.has(key),
                    onDidChangeAttached: (listener: () => void) => {
                        attachmentListeners.set(key, listener);
                        return { dispose: () => attachmentListeners.delete(key) };
                    },
                    dispose: () => {
                        disposed.add(key);
                        models.delete(key);
                    },
                };
                models.set(resource.toString(), model);
                return model;
            },
        },
    };
    return {
        monaco: {
            ...monaco,
            Uri: { parse: (value: string) => ({ toString: () => value }) },
        },
        model: (uri: string) => models.get(uri) as
            (DefinitionPreviewModel & { content: string; language: string }) | undefined,
        attach: (uri: string) => {
            attached.add(uri);
            attachmentListeners.get(uri)?.();
        },
        detach: (uri: string) => {
            attached.delete(uri);
            attachmentListeners.get(uri)?.();
        },
        disposed,
    };
}

describe('definition preview source', () => {
    it('loads a claimed cross-file target into a temporary Monaco model', async () => {
        const { monaco, model, attach } = createMonaco();
        const load = vi.fn().mockResolvedValue('export class Widget {}');
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = browserDocumentUri('ws-1', 'include/widget.hpp');

        expect(await source.prepare(uri, new AbortController().signal)).toBe(true);
        attach(uri);

        expect(load).toHaveBeenCalledWith('include/widget.hpp', expect.any(AbortSignal));
        expect(model(uri)).toMatchObject({ content: 'export class Widget {}' });
    });

    it('uses the same source for symbol-index fragment targets', async () => {
        const { monaco, model, attach } = createMonaco();
        const load = vi.fn().mockResolvedValue('class Widget {};');
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = `${browserDocumentUri('ws-1', 'include/widget.hpp')}#symbol-index-candidate`;

        expect(await source.prepare(uri, new AbortController().signal)).toBe(true);
        attach(uri);
        expect(model(uri)).toMatchObject({ content: 'class Widget {};' });
        expect(load).toHaveBeenCalledWith('include/widget.hpp', expect.any(AbortSignal));
    });

    it('refuses targets outside the source workspace', async () => {
        const { monaco, model } = createMonaco();
        const load = vi.fn();
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = browserDocumentUri('ws-2', 'src/widget.ts');

        expect(await source.prepare(uri, new AbortController().signal)).toBe(false);
        expect(model(uri)).toBeUndefined();
        expect(load).not.toHaveBeenCalled();
    });

    it('loads an accepted repo-group member through its owner source', async () => {
        const { monaco, model } = createMonaco();
        const load = vi.fn();
        const loadMember = vi.fn().mockResolvedValue('export const shared = true;');
        const source = registerDefinitionPreviewSource({
            monaco,
            workspaceId: 'member-1',
            load,
            resolveTarget: workspaceId => workspaceId === 'member-2' ? loadMember : undefined,
        });
        const uri = browserDocumentUri('member-2', 'src/shared.ts');

        expect(await source.prepare(uri, new AbortController().signal)).toBe(true);
        expect(load).not.toHaveBeenCalled();
        expect(loadMember).toHaveBeenCalledWith('src/shared.ts', expect.any(AbortSignal));
        expect(model(uri)).toMatchObject({ content: 'export const shared = true;' });
    });

    it('creates an unavailable model for a rejected repo-group target without reading it', async () => {
        const { monaco, model } = createMonaco();
        const load = vi.fn();
        const source = registerDefinitionPreviewSource({
            monaco,
            workspaceId: 'member-1',
            load,
            resolveTarget: () => undefined,
            showUnavailableForRejectedTarget: true,
        });
        const uri = browserDocumentUri('outside', 'src/private.ts');

        expect(await source.prepare(uri, new AbortController().signal)).toBe(true);
        expect(load).not.toHaveBeenCalled();
        expect(model(uri)).toMatchObject({ content: 'Definition source unavailable.' });
    });

    it('surfaces read failures without poisoning another target', async () => {
        const { monaco, model, attach } = createMonaco();
        const load = vi.fn(async (path: string) => {
            if (path === 'src/missing.ts') throw new Error('Definition source unavailable');
            return 'export const ok = true;';
        });
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const missing = browserDocumentUri('ws-1', 'src/missing.ts');
        const valid = browserDocumentUri('ws-1', 'src/valid.ts');
        await expect(source.prepare(missing, new AbortController().signal)).resolves.toBe(true);
        attach(missing);
        await expect(source.prepare(valid, new AbortController().signal)).resolves.toBe(true);
        expect(model(missing)).toMatchObject({ content: 'Definition source unavailable.' });
        expect(model(valid)).toMatchObject({ content: 'export const ok = true;' });
    });

    it('aborts pending reads and removes claims when the source is disposed', async () => {
        const { monaco } = createMonaco();
        let readSignal: AbortSignal | undefined;
        const load = vi.fn((_path: string, signal: AbortSignal) => {
            readSignal = signal;
            return new Promise<string>(() => undefined);
        });
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = browserDocumentUri('ws-1', 'src/widget.ts');
        void source.prepare(uri, new AbortController().signal);
        await vi.waitFor(() => expect(readSignal).toBeDefined());
        source.dispose();

        expect(readSignal?.aborted).toBe(true);
        expect(await source.prepare(uri, new AbortController().signal)).toBe(false);
    });

    it('drops a stale read when the definition request is cancelled', async () => {
        const { monaco, model } = createMonaco();
        let finish!: (content: string) => void;
        const load = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = browserDocumentUri('ws-1', 'src/widget.ts');
        const request = new AbortController();

        const prepared = source.prepare(uri, request.signal);
        await expect(prepared).resolves.toBe(true);
        expect(model(uri)).toMatchObject({ content: 'Loading definition source...' });
        request.abort();
        finish('stale content');

        await vi.waitFor(() => expect(model(uri)).toBeUndefined());
    });

    it('aborts a pending read when Peek detaches from its loading model', async () => {
        vi.useFakeTimers();
        const { monaco, model, attach, detach } = createMonaco();
        let readSignal: AbortSignal | undefined;
        const source = registerDefinitionPreviewSource({
            monaco,
            workspaceId: 'ws-1',
            load: (_path, signal) => {
                readSignal = signal;
                return new Promise<string>(() => undefined);
            },
        });
        const uri = browserDocumentUri('ws-1', 'src/widget.ts');

        await source.prepare(uri, new AbortController().signal);
        attach(uri);
        detach(uri);
        await vi.runAllTimersAsync();

        expect(readSignal?.aborted).toBe(true);
        expect(model(uri)).toBeUndefined();
        source.dispose();
        vi.useRealTimers();
    });

    it('disposes every temporary model after Peek detaches', async () => {
        vi.useFakeTimers();
        const { monaco, attach, detach, disposed } = createMonaco();
        const source = registerDefinitionPreviewSource({
            monaco,
            workspaceId: 'ws-1',
            load: async (path) => `source for ${path}`,
        });
        const first = browserDocumentUri('ws-1', 'src/first.ts');
        const second = browserDocumentUri('ws-1', 'src/second.ts');

        await Promise.all([
            source.prepare(first, new AbortController().signal),
            source.prepare(second, new AbortController().signal),
        ]);
        attach(first);
        await vi.runAllTimersAsync();
        expect(disposed.size).toBe(0);

        detach(first);
        await vi.runAllTimersAsync();

        expect(disposed).toEqual(new Set([first, second]));
        source.dispose();
        vi.useRealTimers();
    });

    it('keeps a slow Peek model available and eventually disposes an orphan', async () => {
        vi.useFakeTimers();
        const { monaco, disposed } = createMonaco();
        const source = registerDefinitionPreviewSource({
            monaco,
            workspaceId: 'ws-1',
            load: async () => 'export const slow = true;',
        });
        const uri = browserDocumentUri('ws-1', 'src/slow.ts');

        await source.prepare(uri, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1_100);
        expect(disposed.size).toBe(0);

        await vi.advanceTimersByTimeAsync(28_900);
        expect(disposed).toEqual(new Set([uri]));
        source.dispose();
        vi.useRealTimers();
    });

    describe('external definition sources', () => {
        beforeEach(() => {
            resetExternalSourceStoreForTests();
        });

        const EXTERNAL = externalResourceUri('cap-1', 'string_view');

        function externalSource(monaco: ReturnType<typeof createMonaco>['monaco'], read: unknown) {
            return registerDefinitionPreviewSource({
                monaco,
                workspaceId: 'ws-1',
                load: vi.fn(),
                readExternalSource: read as never,
                languageForFileName: (name: string) => (name.endsWith('.hpp') ? 'cpp' : 'plaintext'),
            });
        }

        it('loads an external target through the attachment that was issued the capability', async () => {
            const { monaco, model } = createMonaco();
            const read = vi.fn().mockResolvedValue({ content: 'class string_view;', displayName: 'string_view', languageHint: 'cpp' });
            const source = externalSource(monaco, read);

            expect(await source.prepare(EXTERNAL, new AbortController().signal, { lineNumber: 3, column: 5 }, true)).toBe(true);

            expect(read).toHaveBeenCalledWith('cap-1', expect.any(AbortSignal));
            expect(model(EXTERNAL)).toMatchObject({ content: 'class string_view;', language: 'cpp' });
        });

        it('publishes the loaded source so the tab that opens next can show it', async () => {
            const { monaco } = createMonaco();
            const source = externalSource(monaco, vi.fn().mockResolvedValue({
                content: '#pragma once', displayName: 'widget.hpp',
            }));

            await source.prepare(externalResourceUri('cap-2', 'widget.hpp'), new AbortController().signal, undefined, true);

            expect(readExternalSourceRecord('cap-2')).toMatchObject({ content: '#pragma once', displayName: 'widget.hpp' });
        });

        it('carries the host\'s reason into the model and the store when the read fails', async () => {
            const { monaco, model } = createMonaco();
            const message = 'That definition source expired. Run Go to Definition again.';
            const source = externalSource(monaco, vi.fn().mockRejectedValue(new Error(message)));

            await source.prepare(EXTERNAL, new AbortController().signal, undefined, true);

            expect(model(EXTERNAL)?.content).toBe(message);
            expect(readExternalSourceRecord('cap-1')).toMatchObject({ failure: message, content: message });
        });

        it('falls back to the generic sentence when the failure says nothing', async () => {
            const { monaco, model } = createMonaco();
            const source = externalSource(monaco, vi.fn().mockRejectedValue(new Error('   ')));

            await source.prepare(EXTERNAL, new AbortController().signal, undefined, true);

            expect(model(EXTERNAL)?.content).toBe('Definition source unavailable.');
        });

        it('republishes for a live model whose record the store already dropped', async () => {
            const { monaco, model } = createMonaco();
            const read = vi.fn().mockResolvedValue({ content: 'class string_view;', displayName: 'string_view' });
            const source = externalSource(monaco, read);

            await source.prepare(EXTERNAL, new AbortController().signal, undefined, true);
            // A Peek left open outlives the store's orphan drop; the model is
            // still here when the user finally confirms the result.
            resetExternalSourceStoreForTests();

            expect(await source.prepare(EXTERNAL, new AbortController().signal, undefined, true)).toBe(true);
            expect(read).toHaveBeenCalledTimes(1);
            expect(readExternalSourceRecord('cap-1')).toMatchObject({ content: 'class string_view;' });
            expect(model(EXTERNAL)?.content).toBe('class string_view;');
        });

        it('loads again for a model another surface created', async () => {
            const { monaco } = createMonaco();
            const first = externalSource(monaco, vi.fn().mockResolvedValue({
                content: 'class string_view;', displayName: 'string_view',
            }));
            await first.prepare(EXTERNAL, new AbortController().signal, undefined, true);
            resetExternalSourceStoreForTests();

            // Every open pane registers its own source against the one Monaco
            // registry, so this one finds a model it has never loaded through.
            const read = vi.fn().mockResolvedValue({ content: 'class string_view;', displayName: 'string_view' });
            const second = externalSource(monaco, read);
            expect(await second.prepare(EXTERNAL, new AbortController().signal, undefined, true)).toBe(true);

            expect(read).toHaveBeenCalledTimes(1);
            expect(readExternalSourceRecord('cap-1')).toMatchObject({ content: 'class string_view;' });
        });

        it('waits for a load another prepare already started', async () => {
            const { monaco } = createMonaco();
            let resolveRead: (value: unknown) => void = () => undefined;
            const read = vi.fn(() => new Promise(resolve => { resolveRead = resolve; }));
            const source = externalSource(monaco, read);

            const first = source.prepare(EXTERNAL, new AbortController().signal, undefined, true);
            const second = source.prepare(EXTERNAL, new AbortController().signal, undefined, true);
            resolveRead({ content: 'class string_view;', displayName: 'string_view' });
            await Promise.all([first, second]);

            expect(read).toHaveBeenCalledTimes(1);
            expect(readExternalSourceRecord('cap-1')).toMatchObject({ content: 'class string_view;' });
        });

        it('shows the unavailable model when this surface has no reader at all', async () => {
            const { monaco, model } = createMonaco();
            const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load: vi.fn() });

            // No `showUnavailableForRejectedTarget`: an exact external result is
            // still reported, because the server named it as the definition.
            expect(await source.prepare(EXTERNAL, new AbortController().signal)).toBe(true);
            expect(model(EXTERNAL)?.content).toBe('Definition source unavailable.');
        });

        it('ignores a malformed external resource', async () => {
            const { monaco } = createMonaco();
            const read = vi.fn();
            const source = externalSource(monaco, read);

            expect(await source.prepare('coc-lsp-external://', new AbortController().signal)).toBe(false);
            expect(read).not.toHaveBeenCalled();
        });
    });
});
