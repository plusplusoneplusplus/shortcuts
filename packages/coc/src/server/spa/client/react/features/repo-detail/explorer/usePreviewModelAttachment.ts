/**
 * usePreviewModelAttachment — everything `PreviewPane` attaches to one mounted
 * Monaco model, under one exact lifetime.
 *
 * The returned `mountModel` builds an `AttachmentScope` per model mount:
 * navigation capture, editing-model registration, definition preview, the
 * shadow language, language providers, the definition link cue and the editor
 * navigator all register their release with it. Model replacement, identity
 * change and unmount dispose the scope once; its aborted signal stops any
 * identity resolution still running from publishing an error or a target.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { resolveOwnedFile } from '../../language-servers/fileIdentity';
import { allowEditingModelTarget, resolveEditingTarget, registerEditingModel } from '../../language-servers/editingModels';
import { browserDocumentUri, parseBrowserDocumentUri, type LanguageDocumentView } from '../../language-servers/documentStore';
import {
    createEditorNavigationController,
    getMonacoLanguage,
    type EditorModelMountContext,
    type EditorNavigationController,
} from '../../../shared/file-viewer/MonacoFileEditor';
import {
    registerLanguageProviders,
    supportsFeature,
    type MonacoLike,
    type ProviderModel,
} from '../../language-servers/languageProviders';
import { installDefinitionLinkCue } from '../../language-servers/definitionLinkCue';
import { applyShadowLanguage, type ShadowMonaco } from '../../language-servers/shadowLanguage';
import {
    registerDefinitionPreviewSource,
    type DefinitionPreviewMonaco,
} from '../../language-servers/definitionPreview';
import {
    isExternalNavigationTarget,
    registerEditorNavigator,
    SYMBOL_CANDIDATE_FRAGMENT,
    type ExternalNavigationTarget,
    type LanguageNavigationTarget,
} from '../../language-servers/editorNavigation';
import { explorerApi } from './explorerApi';
import { createAttachmentScope } from './attachmentScope';
import {
    buildDefinitionOwnerMap,
    editingModelScope,
    type DefinitionOwner,
    type FilePreviewIdentity,
} from './filePreviewIdentity';
import type { FilePreviewHostBridge } from './useFilePreviewSession';

/** A failed file-identity check during Go to Definition, with its retry. */
export interface PreviewIdentityFailure {
    message: string;
    retry(): void;
}

async function loadDefinitionSource(owner: DefinitionOwner, path: string, signal: AbortSignal) {
    const response = await explorerApi.readBlob(owner.workspaceId, path, { signal }, owner.routingRef);
    if (response.encoding !== 'utf-8') {
        throw new Error('Definition source is not readable text.');
    }
    return response.content;
}

export function usePreviewModelAttachment({
    identity, fileName, definitionPreviewOwners, languageView, definitionSupported, host,
    navigationControllerRef, restoreRawView,
}: {
    identity: FilePreviewIdentity;
    fileName: string;
    definitionPreviewOwners: readonly DefinitionOwner[] | undefined;
    languageView: LanguageDocumentView | null;
    definitionSupported: boolean;
    host: Pick<FilePreviewHostBridge, 'onNavigate' | 'onNavigateExternal' | 'onNavigationMount' | 'onNavigationLocation'>;
    navigationControllerRef: MutableRefObject<EditorNavigationController | null>;
    /** Applies a raw-Markdown view saved before the editor last unmounted. */
    restoreRawView: (controller: EditorNavigationController) => void;
}) {
    const { workspaceId, routingRef, editingScope, path } = identity;
    const [identityFailure, setIdentityFailure] = useState<PreviewIdentityFailure | null>(null);
    const identityFailureRef = useRef(identityFailure);
    identityFailureRef.current = identityFailure;
    const clearIdentityFailure = useCallback(() => {
        if (!identityFailureRef.current) return;
        identityFailureRef.current = null;
        setIdentityFailure(null);
    }, []);
    useEffect(() => { setIdentityFailure(null); }, [workspaceId, routingRef, editingScope, path]);

    const owners = useMemo(
        () => buildDefinitionOwnerMap({ workspaceId, routingRef }, definitionPreviewOwners),
        [workspaceId, routingRef, definitionPreviewOwners],
    );
    const groupPreview = definitionPreviewOwners !== undefined;

    // Host handlers are read through refs so a host that rebuilds its
    // callbacks every render does not tear the providers down with them.
    const hostRef = useRef(host);
    hostRef.current = host;

    // A jump that leaves this file. It is answered here rather than in the
    // navigation module because only this pane knows which workspace it is
    // showing: a target in an unowned workspace is not this surface's to open,
    // and declining it leaves Monaco free to fall through instead of opening
    // the wrong repo's file.
    const handleNavigate = useCallback((
        target: LanguageNavigationTarget | ExternalNavigationTarget,
    ) => {
        const { onNavigate, onNavigateExternal, onNavigationLocation } = hostRef.current;
        if (isExternalNavigationTarget(target)) {
            if (!onNavigateExternal) return false;
            const source = navigationControllerRef.current?.capture();
            if (source) onNavigationLocation?.(source, 'jump');
            onNavigateExternal({
                resourceId: target.resourceId,
                name: target.displayName,
                line: target.line,
                column: target.column,
            });
            return true;
        }
        const owner = owners.get(target.workspaceId);
        if (!onNavigate || !owner) return false;
        const source = navigationControllerRef.current?.capture();
        if (source) onNavigationLocation?.(source, 'jump');
        onNavigate({
            ...(owner.workspaceId !== workspaceId ? { workspaceId: owner.workspaceId, routingRef: owner.routingRef } : {}),
            path: target.path,
            name: target.path.split('/').pop() || target.path,
            line: target.line,
            column: target.column,
            ...(target.symbolCandidate ? { symbolCandidate: true } : {}),
        });
        return true;
    }, [owners, workspaceId, navigationControllerRef]);

    // The Monaco language the editor will actually use for this file, so the
    // providers are registered under the same id the model carries.
    const monacoLanguageId = getMonacoLanguage(fileName);

    // With a model in hand and a document behind it, hover / definition /
    // references / completion / signature help become real. Everything is torn
    // down when the model goes away, and rebuilt when the document is replaced,
    // because a provider outliving its buffer would answer out of a closed
    // document.
    //
    // The casts narrow the real Monaco namespace to the structural slices the
    // language modules describe; they carry no runtime Monaco dependency, so
    // this boundary is where the two meet.
    const mountModel = useCallback(({ editor, monaco, model }: EditorModelMountContext) => {
        const scope = createAttachmentScope();
        const navigationController = createEditorNavigationController(editor);
        navigationControllerRef.current = navigationController;
        restoreRawView(navigationController);
        hostRef.current.onNavigationMount?.(navigationController);
        scope.add(() => {
            if (navigationControllerRef.current === navigationController) navigationControllerRef.current = null;
            hostRef.current.onNavigationMount?.(null);
        });
        const initialLocation = navigationController.capture();
        if (initialLocation) hostRef.current.onNavigationLocation?.(initialLocation, 'programmatic');
        const navigationListener = navigationController.subscribe((snapshot, reason) => {
            hostRef.current.onNavigationLocation?.(snapshot, reason);
        });
        scope.add(() => navigationListener.dispose());

        if (!languageView) return () => scope.dispose();

        const unregisterModel = registerEditingModel({
            scope: editingModelScope(workspaceId, routingRef, editingScope), workspaceId, path, model,
        });
        scope.add(unregisterModel);
        const previewSource = registerDefinitionPreviewSource({
            monaco: monaco as unknown as DefinitionPreviewMonaco,
            workspaceId,
            load: (targetPath, signal) => loadDefinitionSource({ workspaceId, routingRef }, targetPath, signal),
            resolveTarget: groupPreview
                ? (targetWorkspaceId) => {
                    const owner = owners.get(targetWorkspaceId);
                    return owner ? (targetPath, signal) => loadDefinitionSource(owner, targetPath, signal) : undefined;
                }
                : undefined,
            // clangd answers a jump into `std::string_view` with a libstdc++
            // header. Only the attachment that received that answer holds the
            // capability to read it, so the reader is this document's own view.
            readExternalSource: (resourceId, signal) => languageView.readExternalSource(resourceId, { signal }),
            readExternalSemanticTokens: (resourceId, signal) =>
                languageView.readExternalSemanticTokens(resourceId, { signal }),
            languageForFileName: getMonacoLanguage,
            showUnavailableForRejectedTarget: groupPreview,
        });
        scope.add(() => previewSource.dispose());
        // Before registering anything, move the model off `typescript` /
        // `javascript` so Monaco's bundled worker stops answering for it. The
        // providers below then register under whichever id the model ended up
        // carrying, which is also the id nothing else provides for.
        const shadow = applyShadowLanguage(monaco as unknown as ShadowMonaco, model);
        if (shadow) scope.add(() => shadow.revert());
        const registration = registerLanguageProviders({
            monaco: monaco as unknown as MonacoLike,
            model: model as unknown as ProviderModel,
            view: languageView,
            languageId: shadow?.languageId ?? monacoLanguageId,
            resolveUri: async (uri, signal, target) => {
                const live = () => !signal.aborted && !scope.signal.aborted;
                try {
                    const document = parseBrowserDocumentUri(uri);
                    if (document) {
                        const owner = owners.get(document.workspaceId);
                        if (!owner) throw new Error('Definition owner is unavailable. Retry Go to Definition.');
                        const activeSignal = AbortSignal.any([signal, scope.signal]);
                        const ownerScope = editingModelScope(owner.workspaceId, owner.routingRef, editingScope);
                        const { path: resolvedPath, entry } = await resolveEditingTarget(ownerScope, document.path,
                            value => resolveOwnedFile(owner, value, activeSignal), activeSignal);
                        if (entry) {
                            if (live()) clearIdentityFailure();
                            return allowEditingModelTarget(model, entry, uri.endsWith(`#${SYMBOL_CANDIDATE_FRAGMENT}`));
                        }
                        // Query isolates temporary Peek models by concrete owner/session.
                        const fragment = uri.includes('#') ? uri.slice(uri.indexOf('#')) : '';
                        uri = browserDocumentUri(document.workspaceId, resolvedPath)
                            + (editingScope !== undefined || owner.routingRef != null
                                ? `?editing=${encodeURIComponent(ownerScope)}` : '') + fragment;
                    }
                    const prepared = await previewSource.prepare(uri, signal, target, target.waitForContent);
                    if (prepared && live()) clearIdentityFailure();
                    return prepared ? (monaco as unknown as MonacoLike).Uri.parse(uri) : null;
                } catch (error) {
                    if (live()) {
                        setIdentityFailure({
                            message: error instanceof Error ? error.message : 'Cannot confirm file identity.',
                            retry: () => editor.trigger('file-identity', 'editor.action.revealDefinition', null),
                        });
                    }
                    throw error;
                }
            },
        });
        scope.add(() => registration.dispose());
        if (definitionSupported) {
            const definitionLinkCue = installDefinitionLinkCue({
                editor,
                model,
                view: languageView,
                isEnabled: () => supportsFeature(languageView.getSnapshot().state, 'definition')
                    || languageView.getServerInfos().some(info => supportsFeature(info.state, 'definition')),
            });
            scope.add(() => definitionLinkCue.dispose());
        }
        // Claim the navigations that START in this model, so the global editor
        // opener knows which surface asked and lands the target in its strip.
        const navigation = registerEditorNavigator(model, handleNavigate);
        scope.add(() => navigation.dispose());
        return () => scope.dispose();
    }, [
        languageView,
        monacoLanguageId,
        handleNavigate,
        definitionSupported,
        owners,
        groupPreview,
        workspaceId,
        routingRef,
        editingScope,
        path,
        navigationControllerRef,
        restoreRawView,
        clearIdentityFailure,
    ]);

    return { mountModel, identityFailure };
}
