/**
 * diffLanguageMount — hover, go-to-definition and friends on the modified side
 * of an unstaged diff (AC-06).
 *
 * The same pieces the explorer's `PreviewPane` mounts on its model, minus the
 * parts that only make sense for an editable tab (navigation history, save):
 *
 *   - the shadow language, so Monaco's bundled TS/JS worker stops answering;
 *   - `registerLanguageProviders`, scoped to this one model;
 *   - the definition preview source, so Peek can load targets in this workspace;
 *   - the Ctrl/Cmd-hover definition cue;
 *   - an `editorNavigation` navigator for jumps that leave this file.
 *
 * Callers must only hand this the model `resolveDiffLanguageTarget` accepted;
 * the adapter enforces that by comparing the model URI before mounting.
 * No Monaco value import: the namespace arrives in the context.
 */

import { explorerApi } from '../../repo-detail/explorer/explorerApi';
import { getMonacoLanguage } from '../../../shared/file-viewer/monacoLanguage';
import type { LanguageDocumentView } from '../../language-servers/documentStore';
import {
    registerLanguageProviders,
    supportsFeature,
    type MonacoLike,
    type ProviderModel,
} from '../../language-servers/languageProviders';
import { installDefinitionLinkCue, type DefinitionLinkCueEditor } from '../../language-servers/definitionLinkCue';
import { applyShadowLanguage, type ShadowMonaco } from '../../language-servers/shadowLanguage';
import { registerDefinitionPreviewSource, type DefinitionPreviewMonaco } from '../../language-servers/definitionPreview';
import {
    isExternalNavigationTarget,
    registerEditorNavigator,
    type LanguageNavigationTarget,
} from '../../language-servers/editorNavigation';
import type { DiffLanguageMountContext } from './monacoDiffController';

/** Where a definition in another file of this workspace should open. */
export type DiffDefinitionNavigate = (target: LanguageNavigationTarget) => boolean | void;

export interface MountDiffLanguageOptions extends DiffLanguageMountContext {
    workspaceId: string;
    view: LanguageDocumentView;
    /** Monaco language id the model was created with. */
    languageId: string;
    /** Opens a cross-file target; absent means cross-file jumps are declined. */
    onNavigate?: DiffDefinitionNavigate;
    /** Reads another file's text for Peek; defaults to the explorer blob API. */
    loadSource?: (path: string, signal: AbortSignal) => Promise<string>;
}

function definitionEnabled(view: LanguageDocumentView): boolean {
    return supportsFeature(view.getSnapshot().state, 'definition')
        || view.getServerInfos().some(info => supportsFeature(info.state, 'definition'));
}

/** Registers everything on `model`; the returned cleanup undoes it in reverse. */
export function mountDiffLanguageModel(options: MountDiffLanguageOptions): () => void {
    const { editor, monaco, model, view, workspaceId, languageId, onNavigate } = options;
    const loadSource = options.loadSource ?? (async (path: string, signal: AbortSignal) => {
        const response = await explorerApi.readBlob(workspaceId, path, { signal });
        if (response.encoding !== 'utf-8') throw new Error('Definition source is not readable text.');
        return response.content;
    });

    // The structural slices each module declares; the real namespace satisfies them all.
    const previewSource = registerDefinitionPreviewSource({
        monaco: monaco as unknown as DefinitionPreviewMonaco,
        workspaceId,
        load: loadSource,
        readExternalSource: (resourceId, signal) => view.readExternalSource(resourceId, { signal }),
        languageForFileName: getMonacoLanguage,
    });
    const shadow = applyShadowLanguage(monaco as unknown as ShadowMonaco, model);
    const registration = registerLanguageProviders({
        monaco: monaco as unknown as MonacoLike,
        model: model as unknown as ProviderModel,
        view,
        languageId: shadow?.languageId ?? languageId,
        resolveUri: async (uri, signal, target) => (
            await previewSource.prepare(uri, signal, target, target.waitForContent)
                ? (monaco as unknown as MonacoLike).Uri.parse(uri)
                : null
        ),
    });
    const linkCue = installDefinitionLinkCue({
        editor: editor as unknown as DefinitionLinkCueEditor,
        model,
        view,
        isEnabled: () => definitionEnabled(view),
    });
    // A diff has no tab strip for external sources; those jumps, and any into
    // another workspace, are declined so Monaco falls through.
    const navigation = registerEditorNavigator(model, (target) => {
        if (isExternalNavigationTarget(target) || target.workspaceId !== workspaceId || !onNavigate) return false;
        return onNavigate(target) !== false;
    });

    return () => {
        navigation.dispose();
        linkCue.dispose();
        registration.dispose();
        previewSource.dispose();
        shadow?.revert();
    };
}
