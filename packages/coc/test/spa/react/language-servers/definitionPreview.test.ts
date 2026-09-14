import { describe, expect, it, vi } from 'vitest';
import { browserDocumentUri } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    registerDefinitionPreviewSource,
    type DefinitionPreviewModel,
    type DefinitionPreviewUri,
} from '../../../../src/server/spa/client/react/features/language-servers/definitionPreview';

function createMonaco() {
    const models = new Map<string, DefinitionPreviewModel>();
    const attachmentListeners = new Map<string, () => void>();
    const attached = new Set<string>();
    const disposed = new Set<string>();
    const monaco = {
        editor: {
            getModel: (resource: DefinitionPreviewUri) => models.get(resource.toString()) ?? null,
            createModel: (content: string, _language: string | undefined, resource: DefinitionPreviewUri) => {
                const key = resource.toString();
                const model = {
                    uri: resource,
                    content,
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
        model: (uri: string) => models.get(uri) as (DefinitionPreviewModel & { content: string }) | undefined,
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
        request.abort();
        finish('stale content');

        await expect(prepared).resolves.toBe(false);
        expect(model(uri)).toBeUndefined();
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
});
