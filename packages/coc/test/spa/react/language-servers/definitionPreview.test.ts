import { describe, expect, it, vi } from 'vitest';
import { browserDocumentUri } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    registerDefinitionPreviewSource,
    type DefinitionPreviewModel,
    type DefinitionPreviewUri,
} from '../../../../src/server/spa/client/react/features/language-servers/definitionPreview';

function createMonaco() {
    const models = new Map<string, DefinitionPreviewModel>();
    let provider: {
        provideTextContent(resource: DefinitionPreviewUri): Promise<DefinitionPreviewModel | null>;
    } | null = null;
    const monaco = {
        editor: {
            registerTextModelContentProvider: (
                scheme: string,
                value: typeof provider,
            ) => {
                expect(scheme).toBe('coc-file');
                provider = value;
                return { dispose: vi.fn() };
            },
            getModel: (resource: DefinitionPreviewUri) => models.get(resource.toString()) ?? null,
            createModel: (content: string, _language: string | undefined, resource: DefinitionPreviewUri) => {
                const model = { uri: resource, content };
                models.set(resource.toString(), model);
                return model;
            },
        },
    };
    return {
        monaco,
        resolve: (uri: string) => {
            if (!provider) throw new Error('No content provider installed');
            return provider.provideTextContent({ toString: () => uri });
        },
    };
}

describe('definition preview source', () => {
    it('loads a claimed cross-file target into a temporary Monaco model', async () => {
        const { monaco, resolve } = createMonaco();
        const load = vi.fn().mockResolvedValue('export class Widget {}');
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = browserDocumentUri('ws-1', 'include/widget.hpp');

        expect(source.claim(uri)).toBe(true);
        const model = await resolve(uri);

        expect(load).toHaveBeenCalledWith('include/widget.hpp', expect.any(AbortSignal));
        expect(model).toMatchObject({ content: 'export class Widget {}' });
    });

    it('uses the same source for symbol-index fragment targets', async () => {
        const { monaco, resolve } = createMonaco();
        const load = vi.fn().mockResolvedValue('class Widget {};');
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = `${browserDocumentUri('ws-1', 'include/widget.hpp')}#symbol-index-candidate`;

        expect(source.claim(uri)).toBe(true);
        expect(await resolve(uri)).toMatchObject({ content: 'class Widget {};' });
        expect(load).toHaveBeenCalledWith('include/widget.hpp', expect.any(AbortSignal));
    });

    it('refuses targets outside the source workspace', async () => {
        const { monaco, resolve } = createMonaco();
        const load = vi.fn();
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = browserDocumentUri('ws-2', 'src/widget.ts');

        expect(source.claim(uri)).toBe(false);
        expect(await resolve(uri)).toBeNull();
        expect(load).not.toHaveBeenCalled();
    });

    it('surfaces read failures without poisoning another target', async () => {
        const { monaco, resolve } = createMonaco();
        const load = vi.fn(async (path: string) => {
            if (path === 'src/missing.ts') throw new Error('Definition source unavailable');
            return 'export const ok = true;';
        });
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const missing = browserDocumentUri('ws-1', 'src/missing.ts');
        const valid = browserDocumentUri('ws-1', 'src/valid.ts');
        source.claim(missing);
        source.claim(valid);

        await expect(resolve(missing)).rejects.toThrow('Definition source unavailable');
        await expect(resolve(valid)).resolves.toMatchObject({ content: 'export const ok = true;' });
    });

    it('aborts pending reads and removes claims when the source is disposed', async () => {
        const { monaco, resolve } = createMonaco();
        let readSignal: AbortSignal | undefined;
        const load = vi.fn((_path: string, signal: AbortSignal) => {
            readSignal = signal;
            return new Promise<string>(() => undefined);
        });
        const source = registerDefinitionPreviewSource({ monaco, workspaceId: 'ws-1', load });
        const uri = browserDocumentUri('ws-1', 'src/widget.ts');
        source.claim(uri);

        void resolve(uri);
        await vi.waitFor(() => expect(readSignal).toBeDefined());
        source.dispose();

        expect(readSignal?.aborted).toBe(true);
        expect(await resolve(uri)).toBeNull();
    });
});
