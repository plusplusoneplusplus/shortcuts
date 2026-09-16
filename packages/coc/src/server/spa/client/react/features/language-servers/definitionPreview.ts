import { parseBrowserDocumentUri } from './documentStore';
import {
    externalSourceLanguageId,
    parseExternalResourceUri,
    type ExternalSourceContent,
} from './externalSource';
import { publishExternalSource } from './externalSourceStore';

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
    getLanguageId?(): string;
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
        /** Set once the external read reveals what the file actually is. */
        setModelLanguage?: (model: DefinitionPreviewModel, languageId: string) => void;
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
    /**
     * Reads a file the language server named outside every workspace, through
     * the attachment that was issued the capability. Absent when this surface
     * has no live language attachment, in which case an external target falls
     * through to the unavailable model.
     */
    readExternalSource?: (resourceId: string, signal: AbortSignal) => Promise<ExternalSourceContent>;
    /** Monaco language for a file name; used to highlight an external source. */
    languageForFileName?: (fileName: string) => string;
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
            if (disposed || signal.aborted) return false;
            // Two kinds of target reach Peek: a repo document, addressed by
            // workspace and path, and a file outside every workspace that only
            // the issuing attachment can read. Both end up as a temporary model
            // with the same lifecycle; only the loader differs.
            const external = parseExternalResourceUri(uri);
            const target = external ? null : parseBrowserDocumentUri(uri);
            if (!external && !target) return false;
            const readExternal = options.readExternalSource;
            const documentLoad = target
                ? (target.workspaceId === options.workspaceId
                    ? options.load
                    : options.resolveTarget?.(target.workspaceId))
                : undefined;
            // A document loader returns text; an external read returns text
            // plus the safe name the language choice needs. Normalizing after
            // the load, rather than behind another promise, keeps the ordinary
            // preview path exactly as many ticks from content as it was.
            const load: ((signal: AbortSignal) => Promise<string | ExternalSourceContent>) | undefined = external
                ? (readExternal ? (loadSignal) => readExternal(external.resourceId, loadSignal) : undefined)
                : (documentLoad ? (loadSignal) => documentLoad(target!.path, loadSignal) : undefined);
            // An exact external target always gets a model, even with no reader:
            // the server named it as the definition, so "unavailable" is the
            // honest answer where declining would show the user nothing at all.
            if (!load && !external && !options.showUnavailableForRejectedTarget) {
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
                const loading = load(controller.signal)
                    .then(result => {
                        const source = typeof result === 'string'
                            ? { content: result, displayName: target?.path ?? '' }
                            : result;
                        if (!controller.signal.aborted && !disposed && models.get(uri) === record) {
                            if (external) {
                                // Hand the content over: confirming this result
                                // unmounts the pane whose attachment owns the
                                // capability, so the tab that opens next reads
                                // what was loaded here rather than re-fetching
                                // through a connection that is going away.
                                publishExternalSource({ ...source, resourceId: external.resourceId });
                            }
                            if (external && options.languageForFileName) {
                                const languageId = externalSourceLanguageId(source, options.languageForFileName);
                                if (languageId !== model.getLanguageId?.()) {
                                    options.monaco.editor.setModelLanguage?.(model, languageId);
                                }
                            }
                            model.setValue(source.content);
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
