import { parseBrowserDocumentUri } from './documentStore';
import {
    externalSourceLanguageId,
    parseExternalResourceUri,
    type ExternalSourceContent,
} from './externalSource';
import {
    publishExternalSource,
    readExternalSourceRecord,
    type ExternalSourceRecord,
} from './externalSourceStore';

const ORPHAN_MODEL_TIMEOUT_MS = 30_000;

/** Shown when a read failed without saying anything more useful. */
const UNAVAILABLE_MESSAGE = 'Definition source unavailable.';

/**
 * The host answers a failed external read with a sentence that names the
 * cause — expired capability, missing file, too large. Showing that instead of
 * a generic line is what tells the user whether retrying is worth anything.
 */
function failureMessage(error: unknown): string {
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message.trim() ? message.trim() : UNAVAILABLE_MESSAGE;
}

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

interface PreviewModelRecord {
    model: DefinitionPreviewModel;
    attachment?: DefinitionPreviewDisposable;
    controller?: AbortController;
    wasAttached: boolean;
    /** In flight, so a later prepare for the same URI waits instead of racing it. */
    loading?: Promise<void>;
    /** What was last published, so the store can be refilled after it drops it. */
    published?: ExternalSourceRecord;
    /**
     * False for a model another surface created: every open pane registers its
     * own source against the one Monaco registry, so loading through a foreign
     * model is fine while disposing it would pull it out from under that pane.
     */
    owned: boolean;
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
    const models = new Map<string, PreviewModelRecord>();
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const disposeModels = () => {
        for (const { model, attachment, controller, owned } of models.values()) {
            controller?.abort();
            attachment?.dispose();
            if (owned) model.dispose?.();
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

    /** Track a model another surface created, without taking over its life. */
    const adopt = (uri: string, model: DefinitionPreviewModel): PreviewModelRecord => {
        const record: PreviewModelRecord = { model, wasAttached: false, owned: false };
        models.set(uri, record);
        return record;
    };

    /**
     * Fills `record.model` from `load`, and for an external target hands the
     * result to the store as well: confirming the result unmounts the pane whose
     * attachment owns the capability, so the tab that opens next reads what was
     * loaded here rather than re-fetching through a connection that is going
     * away. Kept on the record so a second prepare can await it.
     */
    const beginLoad = (
        uri: string,
        record: PreviewModelRecord,
        external: { resourceId: string; displayName: string } | null,
        fallbackName: string,
        load: (signal: AbortSignal) => Promise<string | ExternalSourceContent>,
        position: { lineNumber: number; column: number },
        signal: AbortSignal,
    ): Promise<void> => {
        const { model } = record;
        const controller = new AbortController();
        record.controller = controller;
        const live = () => !controller.signal.aborted && !disposed && models.get(uri) === record;
        const abort = () => {
            controller.abort();
            if (models.get(uri) !== record) return;
            record.attachment?.dispose();
            if (record.owned) record.model.dispose?.();
            models.delete(uri);
        };
        signal.addEventListener('abort', abort, { once: true });
        controllers.add(controller);
        const publish = (published: ExternalSourceRecord) => {
            record.published = published;
            publishExternalSource(published);
        };
        const loading = load(controller.signal)
            .then(result => {
                const source = typeof result === 'string'
                    ? { content: result, displayName: fallbackName }
                    : result;
                if (!live()) return;
                if (external) {
                    publish({ ...source, resourceId: external.resourceId });
                    if (options.languageForFileName) {
                        const languageId = externalSourceLanguageId(source, options.languageForFileName);
                        if (languageId !== model.getLanguageId?.()) {
                            options.monaco.editor.setModelLanguage?.(model, languageId);
                        }
                    }
                }
                model.setValue(source.content);
                setTimeout(() => {
                    if (!live()) return;
                    for (const candidate of options.monaco.editor.getEditors?.() ?? []) {
                        if (candidate.getModel?.() !== model) continue;
                        candidate.setPosition?.(position);
                        candidate.revealPositionInCenter?.(position);
                    }
                }, 0);
            })
            .catch((error: unknown) => {
                if (!live()) return;
                // Only an external read is described in words meant for the
                // user; a document load fails with whatever the fetch threw.
                const message = external ? failureMessage(error) : UNAVAILABLE_MESSAGE;
                // Publish the reason too: the tab reads the store, and a bare
                // "unavailable" there hides what the host already explained.
                if (external) {
                    publish({
                        resourceId: external.resourceId,
                        content: message,
                        displayName: external.displayName,
                        failure: message,
                    });
                }
                model.setValue(message);
            })
            .finally(() => {
                if (record.loading === loading) record.loading = undefined;
                signal.removeEventListener('abort', abort);
                controllers.delete(controller);
            });
        record.loading = loading;
        return loading;
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
            const existingModel = options.monaco.editor.getModel?.(resource);
            if (existingModel) {
                // A Peek left open outlives the store's orphan drop, so the
                // model can still be here after the record the confirming tab
                // reads is gone. Put content back before reporting it ready.
                if (external) {
                    const tracked = models.get(uri)
                        // Every open pane registers its own source against the
                        // one Monaco registry, so the model may belong to a
                        // pane that is still showing it.
                        ?? adopt(uri, existingModel);
                    if (tracked.loading) {
                        if (waitForContent) await tracked.loading;
                    } else if (!readExternalSourceRecord(external.resourceId)) {
                        if (tracked.published) {
                            publishExternalSource(tracked.published);
                        } else if (load) {
                            const loading = beginLoad(
                                uri, tracked, external, external.displayName, load, position, signal,
                            );
                            if (waitForContent) await loading;
                        }
                    }
                }
                return true;
            }
            const createModel = options.monaco.editor.createModel;
            if (!createModel) return false;

            const model = createModel(
                `${'\n'.repeat(Math.max(0, position.lineNumber - 1))}${
                    ' '.repeat(Math.max(0, position.column - 1))
                }${load ? 'Loading definition source...' : UNAVAILABLE_MESSAGE}`,
                undefined,
                resource,
            );
            const record: PreviewModelRecord = { model, wasAttached: false, owned: true };
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
                const loading = beginLoad(
                    uri, record, external, target?.path ?? '', load, position, signal,
                );
                if (waitForContent) {
                    await loading;
                    return !record.controller?.signal.aborted && !disposed && models.get(uri) === record;
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
