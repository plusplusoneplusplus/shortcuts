import { parseBrowserDocumentUri } from './documentStore';

const PEEK_ATTACH_GRACE_MS = 1_000;

export interface DefinitionPreviewDisposable {
    dispose(): void;
}

export interface DefinitionPreviewUri {
    toString(): string;
}

export interface DefinitionPreviewModel {
    uri: DefinitionPreviewUri;
    dispose?(): void;
    isAttachedToEditor?(): boolean;
    onDidChangeAttached?(listener: () => void): DefinitionPreviewDisposable;
}

export interface DefinitionPreviewMonaco {
    Uri: {
        parse(value: string): DefinitionPreviewUri;
    };
    editor: {
        getModel?: (resource: DefinitionPreviewUri) => DefinitionPreviewModel | null;
        createModel?: (
            value: string,
            language: string | undefined,
            resource: DefinitionPreviewUri,
        ) => DefinitionPreviewModel;
    };
}

export interface DefinitionPreviewSource {
    prepare(uri: string, signal: AbortSignal): Promise<boolean>;
    dispose(): void;
}

/**
 * Creates temporary models before Monaco's standalone Peek resolver asks for
 * them. Models stay alive while Peek has one attached and are released after it
 * closes, or immediately when the owning editor registration is disposed.
 */
export function registerDefinitionPreviewSource(options: {
    monaco: DefinitionPreviewMonaco;
    workspaceId: string;
    load(path: string, signal: AbortSignal): Promise<string>;
}): DefinitionPreviewSource {
    const controllers = new Set<AbortController>();
    const models = new Map<string, {
        model: DefinitionPreviewModel;
        attachment?: DefinitionPreviewDisposable;
    }>();
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const disposeModels = () => {
        for (const { model, attachment } of models.values()) {
            attachment?.dispose();
            model.dispose?.();
        }
        models.clear();
    };

    const scheduleDetachedCleanup = () => {
        if (cleanupTimer || disposed) return;
        cleanupTimer = setTimeout(() => {
            cleanupTimer = null;
            if ([...models.values()].some(({ model }) => model.isAttachedToEditor?.())) {
                return;
            }
            disposeModels();
        }, PEEK_ATTACH_GRACE_MS);
    };

    return {
        prepare: async (uri, signal) => {
            const target = parseBrowserDocumentUri(uri);
            if (!target || target.workspaceId !== options.workspaceId || disposed || signal.aborted) {
                return false;
            }

            const resource = options.monaco.Uri.parse(uri);
            if (options.monaco.editor.getModel?.(resource)) return true;
            const createModel = options.monaco.editor.createModel;
            if (!createModel) return false;

            const controller = new AbortController();
            const abort = () => controller.abort();
            signal.addEventListener('abort', abort, { once: true });
            controllers.add(controller);
            let content: string;
            try {
                content = await options.load(target.path, controller.signal);
            } catch {
                if (controller.signal.aborted || disposed) return false;
                content = 'Definition source unavailable.';
            } finally {
                signal.removeEventListener('abort', abort);
                controllers.delete(controller);
            }
            if (controller.signal.aborted || disposed) return false;

            if (!options.monaco.editor.getModel?.(resource)) {
                const model = createModel(content, undefined, resource);
                const attachment = model.onDidChangeAttached?.(scheduleDetachedCleanup);
                models.set(uri, { model, attachment });
                scheduleDetachedCleanup();
            }
            return true;
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            for (const controller of controllers) controller.abort();
            controllers.clear();
            if (cleanupTimer) {
                clearTimeout(cleanupTimer);
                cleanupTimer = null;
            }
            disposeModels();
        },
    };
}
