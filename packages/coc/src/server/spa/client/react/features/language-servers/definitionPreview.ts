import { parseBrowserDocumentUri } from './documentStore';

export interface DefinitionPreviewDisposable {
    dispose(): void;
}

export interface DefinitionPreviewUri {
    toString(): string;
}

export interface DefinitionPreviewModel {
    uri: DefinitionPreviewUri;
}

export interface DefinitionPreviewMonaco {
    editor: {
        registerTextModelContentProvider?: (
            scheme: string,
            provider: {
                provideTextContent(resource: DefinitionPreviewUri): Promise<DefinitionPreviewModel | null>;
            },
        ) => DefinitionPreviewDisposable;
        getModel?: (resource: DefinitionPreviewUri) => DefinitionPreviewModel | null;
        createModel?: (
            value: string,
            language: string | undefined,
            resource: DefinitionPreviewUri,
        ) => DefinitionPreviewModel;
    };
}

export interface DefinitionPreviewSource {
    claim(uri: string): boolean;
    dispose(): void;
}

interface SourceRegistration {
    workspaceId: string;
    load(path: string, signal: AbortSignal): Promise<string>;
    controllers: Set<AbortController>;
    disposed: boolean;
}

interface ProviderState {
    claims: Map<string, SourceRegistration>;
    provider: DefinitionPreviewDisposable;
}

const providers = new WeakMap<object, ProviderState>();

function installProvider(monaco: DefinitionPreviewMonaco): ProviderState | null {
    const existing = providers.get(monaco as object);
    if (existing) return existing;

    const register = monaco.editor.registerTextModelContentProvider;
    const getModel = monaco.editor.getModel;
    const createModel = monaco.editor.createModel;
    if (!register || !getModel || !createModel) return null;

    const claims = new Map<string, SourceRegistration>();
    const provider = register('coc-file', {
        provideTextContent: async (resource) => {
            const key = resource.toString();
            const source = claims.get(key);
            const target = parseBrowserDocumentUri(key);
            if (!source || !target || target.workspaceId !== source.workspaceId || source.disposed) {
                return null;
            }

            const current = getModel(resource);
            if (current) return current;

            const controller = new AbortController();
            source.controllers.add(controller);
            try {
                const content = await source.load(target.path, controller.signal);
                if (controller.signal.aborted || source.disposed || claims.get(key) !== source) {
                    return null;
                }
                return getModel(resource) ?? createModel(content, undefined, resource);
            } finally {
                source.controllers.delete(controller);
            }
        },
    });
    const state = { claims, provider };
    providers.set(monaco as object, state);
    return state;
}

/**
 * Makes definition targets produced by one live editor readable by Monaco's
 * Peek view. Claims are temporary and are removed with the editor registration.
 */
export function registerDefinitionPreviewSource(options: {
    monaco: DefinitionPreviewMonaco;
    workspaceId: string;
    load(path: string, signal: AbortSignal): Promise<string>;
}): DefinitionPreviewSource {
    const state = installProvider(options.monaco);
    const source: SourceRegistration = {
        workspaceId: options.workspaceId,
        load: options.load,
        controllers: new Set(),
        disposed: false,
    };
    const claimed = new Set<string>();

    return {
        claim: (uri) => {
            const target = parseBrowserDocumentUri(uri);
            if (!target || target.workspaceId !== source.workspaceId || source.disposed) {
                return false;
            }
            if (!state) return true;
            state.claims.set(uri, source);
            claimed.add(uri);
            return true;
        },
        dispose: () => {
            if (source.disposed) return;
            source.disposed = true;
            for (const controller of source.controllers) controller.abort();
            source.controllers.clear();
            if (!state) return;
            for (const uri of claimed) {
                if (state.claims.get(uri) === source) state.claims.delete(uri);
            }
            claimed.clear();
        },
    };
}
