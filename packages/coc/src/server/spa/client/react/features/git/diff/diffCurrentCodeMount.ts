/** Definition-only providers for a historical side; never opens an LSP document. */
import type * as MonacoApi from 'monaco-editor';
import type { CancellationToken, IPosition } from 'monaco-editor';
import { browserDocumentUri } from '../../language-servers/documentStore';
import { installDefinitionLinkCue, type DefinitionLinkCueEditor } from '../../language-servers/definitionLinkCue';
import { registerDefinitionPreviewSource, type DefinitionPreviewMonaco } from '../../language-servers/definitionPreview';
import { isExternalNavigationTarget, registerEditorNavigator, SYMBOL_CANDIDATE_FRAGMENT } from '../../language-servers/editorNavigation';
import { applyShadowLanguage, type ShadowMonaco } from '../../language-servers/shadowLanguage';
import { explorerApi } from '../../repo-detail/explorer/explorerApi';
import { getMonacoLanguage } from '../../../shared/file-viewer/monacoLanguage';
import { createCurrentCodeDefinitions, type CurrentCodeDefinitions } from './currentCodeDefinitions';
import { installNoDefinitionFeedback, type DiffNoDefinition } from './diffDefinitionFeedback';
import { DIFF_LANGUAGE_MAX_CHARS } from './diffLanguageEligibility';
import type { DiffDefinitionNavigate } from './diffLanguageMount';
import type { DiffLanguageMountContext } from './monacoDiffController';
import { DIFF_REF_URI_SCHEME } from './monacoDiffOptions';

/** Appended to each Peek target line; Peek has no per-result label of its own. */
export const CURRENT_CODE_TAG = 'current code';

type MonacoPreviewModel = Pick<MonacoApi.editor.ITextModel, 'deltaDecorations'> & { isDisposed?(): boolean };

export interface MountDiffCurrentCodeOptions extends DiffLanguageMountContext {
    workspaceId: string;
    routingRef?: string | null;
    onNavigate?: DiffDefinitionNavigate;
    /** A Ctrl/Cmd+Click on a word the current code does not define. */
    onNoDefinition?: DiffNoDefinition;
    loadSource?: (path: string, signal: AbortSignal) => Promise<string>;
    /** Injectable lookup, owned and disposed by this mount. */
    definitions?: CurrentCodeDefinitions;
}

export function mountDiffCurrentCodeModel(options: MountDiffCurrentCodeOptions): () => void {
    const { model, editor, monaco, workspaceId, routingRef, onNavigate } = options;
    // Live models belong to mountDiffLanguageModel. A host must opt into this
    // separate path only for a local historical review (never a PR).
    const uri = model.uri.toString();
    if (!workspaceId || !uri.startsWith(`${DIFF_REF_URI_SCHEME}://${encodeURIComponent(workspaceId)}/`)
        || model.getValueLength() > DIFF_LANGUAGE_MAX_CHARS) {
        return () => {};
    }
    const definitions = options.definitions ?? createCurrentCodeDefinitions(workspaceId, routingRef);
    const pending = new Set<AbortController>();
    let disposed = false;
    const preview = registerDefinitionPreviewSource({
        monaco: monaco as unknown as DefinitionPreviewMonaco,
        workspaceId,
        languageForFileName: getMonacoLanguage,
        load: options.loadSource ?? (async (path, signal) => {
            const blob = await explorerApi.readBlob(workspaceId, path, { signal }, routingRef);
            if (blob.encoding !== 'utf-8') throw new Error('Definition source is not readable text.');
            return blob.content;
        }),
    });
    // Peek shows the preview model, not the hover, so the provenance tag sits
    // on the target line itself. Decorations are ours to remove; the model may
    // belong to (or outlive us in) another surface.
    const tags = new Map<string, { model: MonacoPreviewModel; ids: string[] }>();
    const tagPreview = (uri: string, line: number) => {
        const preview = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (!preview || preview.isDisposed?.()) return;
        const previous = tags.get(uri);
        const ids = preview.deltaDecorations(previous?.model === preview ? previous.ids : [], [{
            range: { startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: 1 },
            options: {
                isWholeLine: true,
                after: { content: CURRENT_CODE_TAG, inlineClassName: 'coc-current-code-tag' },
            },
        }]);
        tags.set(uri, { model: preview, ids });
    };
    const shadow = applyShadowLanguage(monaco as unknown as ShadowMonaco, model);
    const lookup = async (position: IPosition, signal: AbortSignal) => {
        const word = model.getWordAtPosition(position);
        if (disposed || signal.aborted || !word) return [];
        const targets = await definitions.lookup(word.word, signal);
        return disposed || signal.aborted ? [] : targets.filter(target => target.workspaceId === workspaceId);
    };
    // Each Monaco invocation owns its cancellation; hover and definition may
    // run concurrently without abandoning each other's results.
    const request = async <T>(token: CancellationToken, run: (signal: AbortSignal) => Promise<T>) => {
        if (disposed || token.isCancellationRequested) return null;
        const abort = new AbortController();
        pending.add(abort);
        const subscription = token.onCancellationRequested(() => abort.abort());
        try {
            const result = await run(abort.signal);
            return disposed || abort.signal.aborted ? null : result;
        } catch {
            return null;
        } finally {
            subscription?.dispose();
            pending.delete(abort);
        }
    };
    const languageId = shadow?.languageId ?? model.getLanguageId();
    const definition = monaco.languages.registerDefinitionProvider(languageId, {
        provideDefinition: (target, position, token) => target !== model ? null : request(token, async signal => {
            const targets = await lookup(position, signal);
            const locations = await Promise.all(targets.map(async target => {
                const uri = `${browserDocumentUri(workspaceId, target.path)}#${SYMBOL_CANDIDATE_FRAGMENT}`;
                if (!await preview.prepare(uri, signal, { lineNumber: target.line, column: target.column }, true)) return null;
                if (!disposed) tagPreview(uri, target.line);
                return {
                    uri: monaco.Uri.parse(uri),
                    range: {
                        startLineNumber: target.line, endLineNumber: target.line,
                        startColumn: target.column, endColumn: target.column,
                    },
                };
            }));
            return locations.filter(location => location !== null);
        }),
    });
    const hover = monaco.languages.registerHoverProvider(languageId, {
        provideHover: (target, position, token) => target !== model ? null : request(token, async signal => {
            if ((await lookup(position, signal)).length === 0) return null;
            return { contents: [{ value: 'Definition lookup: **current code**' }] };
        }),
    });
    const cue = installDefinitionLinkCue({
        editor: editor as DefinitionLinkCueEditor,
        model,
        isEnabled: () => !disposed,
        hasDefinition: async (position, signal) => (await lookup(position, signal)).length > 0,
    });
    const feedback = installNoDefinitionFeedback({
        editor,
        model,
        onNoDefinition: options.onNoDefinition,
        resolve: async (position, signal) => (await lookup(position, signal)).length > 0,
    });
    const navigation = registerEditorNavigator(model, target => {
        if (isExternalNavigationTarget(target) || target.workspaceId !== workspaceId || !onNavigate) return false;
        return onNavigate(target) !== false;
    });
    return () => {
        if (disposed) return;
        disposed = true;
        for (const abort of pending) abort.abort();
        pending.clear();
        navigation.dispose();
        feedback.dispose();
        cue.dispose();
        hover.dispose();
        definition.dispose();
        for (const { model: tagged, ids } of tags.values()) {
            if (!tagged.isDisposed?.()) tagged.deltaDecorations(ids, []);
        }
        tags.clear();
        preview.dispose();
        definitions.dispose();
        shadow?.revert();
    };
}
