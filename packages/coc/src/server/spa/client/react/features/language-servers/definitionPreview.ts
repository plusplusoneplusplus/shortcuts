import { parseBrowserDocumentUri } from './documentStore';

const ORPHAN_MODEL_TIMEOUT_MS = 30_000;

export interface DefinitionPreviewDisposable {
    dispose(): void;
}

export interface DefinitionPreviewUri {
    toString(): string;
}

export interface DefinitionPreviewModel {
    uri: DefinitionPreviewUri;
    setValue(value: string): void;
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
        getEditors?: () => readonly {
            getModel?(): DefinitionPreviewModel | null;
            setPosition?(position: { lineNumber: number; column: number }): void;
            revealPositionInCenter?(position: { lineNumber: number; column: number }): void;
        }[];
        createModel?: (
            value: string,
            language: string | undefined,
            resource: DefinitionPreviewUri,
        ) => DefinitionPreviewModel;
    };
}

export interface DefinitionPreviewSource {
    prepare(
        uri: string,
        signal: AbortSignal,
        position?: { lineNumber: number; column: number },
        waitForContent?: boolean,
    ): Promise<boolean>;
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
    resolveTarget?: (workspaceId: string) => (
        ((path: string, signal: AbortSignal) => Promise<string>) | undefined
    );
    showUnavailableForRejectedTarget?: boolean;
}): DefinitionPreviewSource {
    const controllers = new Set<AbortController>();
    const models = new Map<string, {
        model: DefinitionPreviewModel;
        attachment?: DefinitionPreviewDisposable;
        controller?: AbortController;
        wasAttached: boolean;
    }>();
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const disposeModels = () => {
        for (const { model, attachment, controller } of models.values()) {
            controller?.abort();
            attachment?.dispose();
            model.dispose?.();
        }
        models.clear();
    };

    const clearCleanupTimer = () => {
        if (!cleanupTimer) return;
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
    };

    const scheduleCleanup = (delay: number) => {
        clearCleanupTimer();
        if (disposed) return;
        cleanupTimer = setTimeout(() => {
            cleanupTimer = null;
            if ([...models.values()].some(({ model }) => model.isAttachedToEditor?.())) {
                return;
            }
            disposeModels();
        }, delay);
    };

    return {
        prepare: async (
            uri,
            signal,
            position = { lineNumber: 1, column: 1 },
            waitForContent = false,
        ) => {
            const target = parseBrowserDocumentUri(uri);
            if (!target || disposed || signal.aborted) return false;
            const load = target?.workspaceId === options.workspaceId
                ? options.load
                : options.resolveTarget?.(target.workspaceId);
            if (!load && !options.showUnavailableForRejectedTarget) {
                return false;
            }

            const resource = options.monaco.Uri.parse(uri);
            if (options.monaco.editor.getModel?.(resource)) return true;
            const createModel = options.monaco.editor.createModel;
            if (!createModel) return false;

            const model = createModel(
                `${'\n'.repeat(Math.max(0, position.lineNumber - 1))}${
                    ' '.repeat(Math.max(0, position.column - 1))
                }${load ? 'Loading definition source...' : 'Definition source unavailable.'}`,
                undefined,
                resource,
            );
            const record: {
                model: DefinitionPreviewModel;
                attachment?: DefinitionPreviewDisposable;
                controller?: AbortController;
                wasAttached: boolean;
            } = { model, wasAttached: false };
            record.attachment = model.onDidChangeAttached?.(() => {
                if (model.isAttachedToEditor?.()) {
                    record.wasAttached = true;
                    clearCleanupTimer();
                } else if (record.wasAttached) {
                    scheduleCleanup(0);
                }
            });
            models.set(uri, record);
            scheduleCleanup(ORPHAN_MODEL_TIMEOUT_MS);

            if (load) {
                const controller = new AbortController();
                record.controller = controller;
                const abort = () => {
                    controller.abort();
                    if (models.get(uri) !== record) return;
                    record.attachment?.dispose();
                    record.model.dispose?.();
                    models.delete(uri);
                };
                signal.addEventListener('abort', abort, { once: true });
                controllers.add(controller);
                const loading = load(target.path, controller.signal)
                    .then(content => {
                        if (!controller.signal.aborted && !disposed && models.get(uri) === record) {
                            model.setValue(content);
                            setTimeout(() => {
                                if (controller.signal.aborted || disposed || models.get(uri) !== record) return;
                                for (const candidate of options.monaco.editor.getEditors?.() ?? []) {
                                    if (candidate.getModel?.() !== model) continue;
                                    candidate.setPosition?.(position);
                                    candidate.revealPositionInCenter?.(position);
                                }
                            }, 0);
                        }
                    })
                    .catch(() => {
                        if (!controller.signal.aborted && !disposed && models.get(uri) === record) {
                            model.setValue('Definition source unavailable.');
                        }
                    })
                    .finally(() => {
                        signal.removeEventListener('abort', abort);
                        controllers.delete(controller);
                    });
                if (waitForContent) {
                    await loading;
                    return !controller.signal.aborted && !disposed && models.get(uri) === record;
                }
            }
            return true;
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            for (const controller of controllers) controller.abort();
            controllers.clear();
            clearCleanupTimer();
            disposeModels();
        },
    };
}
