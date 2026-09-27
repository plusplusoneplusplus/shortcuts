/**
 * monacoDiffEditorAdapter — the one place `DiffEditorAdapter` meets Monaco.
 *
 * Deliberately thin: each method is a direct Monaco call. Ordering, readiness,
 * staleness and disposal policy live in `monacoDiffController.ts`; model
 * sharing lives in `monacoDiffModelRegistry.ts`. The `monaco` namespace is
 * passed in (from `@monaco-editor/react`'s loader, configured with the local
 * bundle in `monaco-setup.ts`), so this module has no Monaco value import.
 */

import { loader } from '@monaco-editor/react';
import type * as MonacoApi from 'monaco-editor';
import type { DiffEditorAdapter, Disposable } from './monacoDiffController';
import type { DiffEditorOptions } from './monacoDiffOptions';
import { createModelRegistry, type ModelLease, type ModelRegistry } from './monacoDiffModelRegistry';

type Monaco = typeof MonacoApi;
type TextModel = MonacoApi.editor.ITextModel;

// One registry per Monaco instance: models are global to it.
const registries = new WeakMap<Monaco, ModelRegistry<TextModel>>();

function registryFor(monaco: Monaco): ModelRegistry<TextModel> {
    let registry = registries.get(monaco);
    if (!registry) {
        registry = createModelRegistry<TextModel>({
            getModel: uri => monaco.editor.getModel(monaco.Uri.parse(uri)),
            createModel: (text, language, uri) => monaco.editor.createModel(text, language, monaco.Uri.parse(uri)),
        });
        registries.set(monaco, registry);
    }
    return registry;
}

export function createMonacoDiffEditorAdapter(
    monaco: Monaco,
    host: HTMLElement,
    options: DiffEditorOptions,
): DiffEditorAdapter {
    const editor = monaco.editor.createDiffEditor(host, options);
    const registry = registryFor(monaco);
    let leases: ModelLease<TextModel>[] = [];

    const releaseLeases = () => {
        for (const lease of leases) lease.release();
        leases = [];
    };

    return {
        setModels(models) {
            // Detach and release the old pair first, so a refreshed file gets
            // its real URI back instead of a conflict variant.
            editor.setModel(null);
            releaseLeases();
            const original = registry.acquire(models.original.uri, models.original.text, models.original.language);
            const modified = registry.acquire(models.modified.uri, models.modified.text, models.modified.language);
            leases = [original, modified];
            editor.setModel({ original: original.model, modified: modified.model });
        },
        updateOptions(next) {
            editor.updateOptions(next);
        },
        setTheme(theme) {
            monaco.editor.setTheme(theme);
        },
        layout(size) {
            editor.layout(size);
        },
        getLineChanges() {
            return editor.getLineChanges();
        },
        onDidUpdateDiff(listener): Disposable {
            return editor.onDidUpdateDiff(listener);
        },
        revealModifiedLine(line) {
            const modified = editor.getModifiedEditor();
            modified.revealLineInCenter(line);
            modified.setPosition({ lineNumber: line, column: 1 });
        },
        dispose() {
            editor.setModel(null);
            editor.dispose();
            releaseLeases();
        },
    };
}

/** Creates a diff editor adapter in `host`; async because Monaco loads lazily. */
export type DiffEditorFactory = (host: HTMLElement, options: DiffEditorOptions) => Promise<DiffEditorAdapter>;

/** Production factory: the loader resolves to the bundled Monaco instance. */
export const createDefaultDiffEditor: DiffEditorFactory = async (host, options) => {
    const monaco = await loader.init();
    return createMonacoDiffEditorAdapter(monaco, host, options);
};
