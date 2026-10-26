import { resolveOwnedFile } from '../../language-servers/fileIdentity';
import { allowEditingModelTarget, resolveEditingTarget, registerEditingModel } from '../../language-servers/editingModels';
import { browserDocumentUri, parseBrowserDocumentUri } from '../../language-servers/documentStore';
/**
 * PreviewPane — the Explorer's file preview: a full-bleed viewer plus a
 * floating close/save toolbar.
 *
 * A thin adapter over the shared file viewer: it injects the `explorerApi`
 * transport, keeps trusted-path read-only forcing, and owns the
 * dirty/status/save callback contract with `ExplorerPanel`. Fetching, retry,
 * truncation and the edit buffer all live in `useFileContent`.
 *
 * It is also the first host of language support (AC-02/AC-03). This is where the
 * decision is made that a blob is a *live repo document*: a real file in this
 * workspace, read whole, reachable on the workspace's own host. A trusted
 * absolute path, a truncated oversize file and a binary blob all stay ordinary
 * viewers with no document behind them. Once that decision is made and the
 * editor has a model, this is also where the model is moved onto its shadow
 * language and the Monaco language providers are registered over the document —
 * one registration per model, disposed with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { Spinner, Button } from '../../../ui';
import { FileViewer } from '../../../shared/file-viewer/FileViewer';
import {
    createEditorNavigationController,
    getMonacoLanguage,
    type EditorModelMountContext,
    type EditorNavigationController,
    type EditorNavigationReason,
    type EditorNavigationSnapshot,
} from '../../../shared/file-viewer/MonacoFileEditor';
import { mountNonEditableModel } from '../../../shared/file-viewer/nonEditableMonacoModel';
import { useFileContent } from '../../../shared/file-viewer/useFileContent';
import { ReloadFromDiskButton } from '../../../shared/file-viewer/ReloadFromDiskButton';
import { UnifiedPanelCloseConfirm } from '../unified-right-panel/UnifiedPanelCloseConfirm';
import { useMarkdownPreview } from '../../../hooks/ui/useMarkdownPreview';
import { toContentChanges } from '../../language-servers/monacoBridge';
import { useLanguageDocument } from '../../language-servers/useLanguageDocument';
import { LanguageStatusBadge } from '../../language-servers/LanguageStatusBadge';
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
import { TRUSTED_PATH_PREFIX } from './ExactOpen';
import { explorerApi } from './explorerApi';
import { WORKSPACE_PREVIEW_PREFIX, readWorkspacePreview, workspacePreviewClient, workspacePreviewUrl } from '../../../shared/file-viewer/workspacePreview';
import { resolveLineRange, toLines } from '../../../shared/file-viewer/lineRange';
import { parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import {
    beginExplorerFileSave, isExplorerPathDeleting, setExplorerFileDirty, useIsExplorerPathDeleting,
} from './explorerDirtyStore';

export interface PreviewPaneProps {
    editingScope?: string;
    repoId: string;
    /** Concrete clone identity for file I/O and language transport routing. */
    routingRef?: string | null;
    /** Live repo-group members whose definition sources this pane may preview. */
    definitionPreviewOwners?: readonly {
        workspaceId: string;
        routingRef?: string | null;
    }[];
    /** Relative path from repo root, or prefixed with TRUSTED_PATH_PREFIX for absolute paths */
    filePath: string;
    /** File name for language detection, e.g. "index.ts" */
    fileName: string;
    /** Unified right-panel opt-in; standalone Explorer keeps its Monaco view. */
    markdownPreview?: boolean;
    /**
     * One-based line to scroll to and highlight once the content is loaded. Set
     * when the file is opened from a content-search hit.
     */
    revealLine?: number;
    endLine?: number;
    /**
     * One-based column within `revealLine` for the cursor. A search hit leaves it
     * unset; a language-server navigation supplies the target symbol's column.
     */
    revealColumn?: number;
    /**
     * Changes whenever the owner navigated here again, even to the position
     * already shown — a repeat pick of the same symbol. Nothing reads the
     * value; it re-runs the editor's reveal so the line re-centres.
     */
    revealNonce?: number;
    /** Shows that this location came from the fuzzy repository symbol index. */
    symbolCandidate?: boolean;
    onClose?: () => void;
    /**
     * Notified whenever the unsaved-edits state changes (and with `false` on
     * unmount). Lets the owner surface dirtiness to the workspace-switch guard so
     * a switch can prompt before discarding edits (AC-03 of preserve-explorer-state).
     */
    onDirtyChange?: (isDirty: boolean) => void;
    /**
     * Hands the owner a way to save this buffer, so a tab-close prompt can write
     * the file without the user re-visiting the tab (AC-04). Called with the save
     * function while the buffer is editable, and with `null` when it stops being
     * editable or unmounts. The function resolves `true` only when the write
     * succeeded — a failed save leaves the buffer dirty and shows the error here.
     */
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
    /**
     * Notified whenever this buffer starts loading, fails, or settles (and with
     * `'ready'` on unmount). Lets the owner mark the matching tab as loading or
     * errored in the tab strip without reaching into the buffer (AC-05/AC-06).
     */
    onStatusChange?: (status: PreviewStatus) => void;
    /**
     * Notified when the blob read fails with a 404 — the file no longer exists
     * on disk. Lets an owner whose file list may be stale (e.g. the working-tree
     * panel) react by refreshing instead of leaving a dead Retry loop.
     */
    onNotFound?: () => void;
    /**
     * Where a "go to definition" that lands in ANOTHER file should open. The
     * surface that renders this pane owns its tab strip, so it is the one that
     * opens or re-activates the target tab and passes the position back down as
     * `revealLine` / `revealColumn`. A pane whose host sets no handler still
     * navigates within its own file — Monaco does that itself — but a
     * cross-file jump is declined, so nothing silently disappears.
     */
    onNavigate?: (target: {
        workspaceId?: string;
        routingRef?: string | null;
        path: string;
        name: string;
        line: number;
        column: number;
        symbolCandidate?: true;
    }) => void;
    /**
     * Where a definition that lands OUTSIDE every workspace should open — a
     * standard-library header, a dependency source. The target carries the
     * host's opaque capability, never a path, and opens read-only. A host that
     * sets no handler declines the jump rather than showing the user nothing.
     */
    onNavigateExternal?: (target: {
        resourceId: string;
        name: string;
        line: number;
        column: number;
    }) => void;
    /** Registers this file's live Monaco location capture/restore handle. */
    onNavigationMount?: (controller: EditorNavigationController | null) => void;
    /** Reports cursor, scroll, search, diagnostic, and language-jump locations. */
    onNavigationLocation?: (snapshot: EditorNavigationSnapshot, reason: EditorNavigationReason) => void;
    /**
     * Publishes the live text model (and `null` when it goes away), so a second
     * view of this file can attach to the same buffer instead of reading its own.
     */
    onModelShare?: (context: EditorModelMountContext | null) => void;
    /**
     * Hands a host-rendered "Reload from disk" control its handler and busy
     * state (and `null` on unmount). A host that sets it renders the button
     * itself; without it the button sits in this pane's floating toolbar.
     */
    onReloadControlChange?: (control: FileReloadControl | null) => void;
}

/** What a host needs to render the "Reload from disk" button for this pane. */
export interface FileReloadControl {
    reload: () => void;
    busy: boolean;
}

/** What a buffer is doing, as reported to its owner through `onStatusChange`. */
export type PreviewStatus = 'loading' | 'error' | 'ready';

function RenderedMarkdown({ content }: { content: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { html } = useMarkdownPreview({ content, containerRef, viewMode: 'review', stripFrontmatter: true });
    return (
        <div className="h-full overflow-auto pt-9" data-testid="preview-markdown-scroll">
            <div
                ref={containerRef}
                className="markdown-body p-4 text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                data-testid="preview-markdown"
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    );
}

export function PreviewPane({ editingScope, repoId, routingRef, definitionPreviewOwners, filePath, fileName, markdownPreview = false, revealLine, endLine, revealColumn, revealNonce, symbolCandidate, onClose, onDirtyChange, onRegisterSave, onStatusChange, onNotFound, onNavigate, onNavigateExternal, onNavigationMount, onNavigationLocation, onModelShare, onReloadControlChange }: PreviewPaneProps) {
    const [identityFailure, setIdentityFailure] = useState<{ message: string; retry(): void } | null>(null);
    const identityFailureRef = useRef(identityFailure);
    identityFailureRef.current = identityFailure;
    const clearIdentityFailure = () => {
        if (!identityFailureRef.current) return;
        identityFailureRef.current = null;
        setIdentityFailure(null);
    };
    useEffect(() => { setIdentityFailure(null); }, [repoId, routingRef, editingScope, filePath]);
    const isTrusted = filePath.startsWith(TRUSTED_PATH_PREFIX);
    const isWorkspacePreview = filePath.startsWith(WORKSPACE_PREVIEW_PREFIX);
    const readOnly = isTrusted || isWorkspacePreview;
    const actualPath = isTrusted ? filePath.slice(TRUSTED_PATH_PREFIX.length)
        : isWorkspacePreview ? filePath.slice(WORKSPACE_PREVIEW_PREFIX.length) : filePath;
    const ownerKey = routingRef ?? repoId;
    const fileInstanceId = useId();
    const deleting = useIsExplorerPathDeleting(ownerKey, actualPath);

    const read = useCallback(async (signal: AbortSignal) => {
        if (!isTrusted && parseRemoteCloneKey(routingRef)) workspacePreviewClient(repoId, routingRef);
        return isWorkspacePreview
            ? readWorkspacePreview(repoId, actualPath, routingRef, signal)
            : isTrusted
            ? explorerApi.readTrustedBlob(actualPath, { signal })
            : routingRef === undefined
                ? explorerApi.readBlob(repoId, actualPath, { signal })
                : explorerApi.readBlob(repoId, actualPath, { signal }, routingRef)
    }, [actualPath, isTrusted, isWorkspacePreview, repoId, routingRef]);

    const write = useMemo(() => (
        readOnly
            ? undefined
            : async (content: string) => {
                if (parseRemoteCloneKey(routingRef)) workspacePreviewClient(repoId, routingRef);
                const finish = beginExplorerFileSave(ownerKey, actualPath);
                try {
                    await (routingRef === undefined
                    ? explorerApi.writeBlob(repoId, actualPath, content)
                    : explorerApi.writeBlob(repoId, actualPath, content, routingRef)
                    );
                } finally {
                    finish();
                }
            }
    ), [readOnly, repoId, actualPath, routingRef, ownerKey]);

    const handleNotFound = useCallback((err: Error) => {
        if ((err as { status?: number }).status === 404) onNotFound?.();
    }, [onNotFound]);

    const {
        blob, displayBlob, isOversized, loading, error, status, retry, reload, reloading,
        isDirty, isSaving, editedContent, onChange: recordEdit, save: writeFile, discard: discardEdits,
    } = useFileContent({
        key: `${routingRef ?? repoId}:${filePath}`,
        read,
        write,
        onError: handleNotFound,
    });

    const viewOnly = readOnly || isOversized || deleting;
    const latestEditRef = useRef(editedContent);
    latestEditRef.current = editedContent;
    useEffect(() => {
        setExplorerFileDirty(ownerKey, fileInstanceId, actualPath, !readOnly && isDirty);
    }, [ownerKey, fileInstanceId, actualPath, readOnly, isDirty]);
    useEffect(() => () => setExplorerFileDirty(ownerKey, fileInstanceId, actualPath, false),
        [ownerKey, fileInstanceId, actualPath]);

    // What the file holds on disk, as far as this pane knows. It starts as the
    // blob that was read and moves forward only when a write succeeds, because
    // `useFileContent` keeps serving the original `blob` after a save. Feeding
    // the stale original to the document store would let a clean buffer be
    // reset to pre-save text.
    const diskText = blob?.encoding === 'utf-8' ? blob.content : '';
    const [savedText, setSavedText] = useState<string | null>(null);
    useEffect(() => { setSavedText(null); }, [blob]);

    // A live repo document, or not. A trusted absolute path belongs to no
    // workspace, an oversize file is shown truncated and must never be sent as
    // if it were complete, and a binary blob has no text to synchronize.
    const languageEnabled = !readOnly && !loading && !error
        && blob?.encoding === 'utf-8' && !isOversized;
    const canPreviewMarkdown = markdownPreview && !isTrusted && !isOversized
        && displayBlob?.encoding === 'utf-8' && /\.(md|markdown)$/i.test(fileName);
    const [rawMarkdown, setRawMarkdownState] = useState(revealLine !== undefined);
    // The mode the pane is heading to, set before React renders it. A model
    // mount that React flushes while the raw editor is being left must not
    // spend the snapshot saved for the way back.
    const rawMarkdownRef = useRef(rawMarkdown);
    const setRawMarkdown = useCallback((raw: boolean) => {
        rawMarkdownRef.current = raw;
        setRawMarkdownState(raw);
    }, []);
    const rawViewStateRef = useRef<EditorNavigationSnapshot | null>(null);
    useEffect(() => {
        if (revealLine === undefined) return;
        rawViewStateRef.current = null;
        setRawMarkdown(true);
    }, [revealLine, revealColumn, revealNonce, setRawMarkdown]);
    useEffect(() => {
        rawViewStateRef.current = null;
        setRawMarkdown(revealLine !== undefined);
    }, [repoId, routingRef, actualPath, setRawMarkdown]);
    const showRendered = canPreviewMarkdown && !rawMarkdown;
    // A reload keeps the reader where they were, so the opening reveal and its
    // highlight must not re-run over the new text. The next navigation here
    // brings them back.
    const [revealRetired, setRevealRetired] = useState(false);
    useEffect(() => { setRevealRetired(false); }, [revealLine, endLine, revealColumn, revealNonce, repoId, routingRef, actualPath]);
    const renderedNavigationController = useMemo<EditorNavigationController>(() => ({
        capture: () => rawViewStateRef.current,
        restore: snapshot => {
            rawViewStateRef.current = snapshot;
            setRawMarkdown(true);
        },
        subscribe: () => ({ dispose: () => undefined }),
    }), [setRawMarkdown]);
    useEffect(() => {
        if (!showRendered || !onNavigationMount) return;
        onNavigationMount(renderedNavigationController);
        return () => onNavigationMount(null);
    }, [showRendered, onNavigationMount, renderedNavigationController]);

    const languageDocument = useLanguageDocument({
        workspaceId: repoId,
        routingRef,
        editingScope,
        path: actualPath,
        enabled: languageEnabled,
        text: savedText ?? diskText,
        fallbackLanguageId: getMonacoLanguage(fileName),
    });
    const {
        handleChange: recordLanguageEdit, markSaved, view: languageView, restart: restartLanguageServer,
    } = languageDocument;

    // The Monaco language the editor will actually use for this file, so the
    // providers are registered under the same id the model carries.
    const monacoLanguageId = getMonacoLanguage(fileName);
    // A jump that leaves this file. It is answered here rather than in the
    // navigation module because only this pane knows which workspace it is
    // showing: a target in another workspace is not this surface's to open, and
    // declining it leaves Monaco free to fall through instead of opening the
    // wrong repo's file. The handler is read through a ref so a host that
    // rebuilds its callback every render does not tear the providers down with
    // it.
    const navigateRef = useRef(onNavigate);
    navigateRef.current = onNavigate;
    const navigateExternalRef = useRef(onNavigateExternal);
    navigateExternalRef.current = onNavigateExternal;
    const navigationMountRef = useRef(onNavigationMount);
    navigationMountRef.current = onNavigationMount;
    const navigationLocationRef = useRef(onNavigationLocation);
    navigationLocationRef.current = onNavigationLocation;
    const navigationControllerRef = useRef<EditorNavigationController | null>(null);
    const handleNavigate = useCallback((
        target: LanguageNavigationTarget | ExternalNavigationTarget,
    ) => {
        if (isExternalNavigationTarget(target)) {
            const navigateExternal = navigateExternalRef.current;
            if (!navigateExternal) return false;
            const source = navigationControllerRef.current?.capture();
            if (source) navigationLocationRef.current?.(source, 'jump');
            navigateExternal({
                resourceId: target.resourceId,
                name: target.displayName,
                line: target.line,
                column: target.column,
            });
            return true;
        }
        const navigate = navigateRef.current;
        const targetOwners = definitionPreviewOwners?.filter(owner => owner.workspaceId === target.workspaceId) ?? [];
        const foreignOwner = target.workspaceId !== repoId && targetOwners.length === 1 ? targetOwners[0] : null;
        if (!navigate || (target.workspaceId !== repoId && !foreignOwner)) return false;
        const source = navigationControllerRef.current?.capture();
        if (source) navigationLocationRef.current?.(source, 'jump');
        navigate({
            ...(foreignOwner ? { workspaceId: foreignOwner.workspaceId, routingRef: foreignOwner.routingRef } : {}),
            path: target.path,
            name: target.path.split('/').pop() || target.path,
            line: target.line,
            column: target.column,
            ...(target.symbolCandidate ? { symbolCandidate: true } : {}),
        });
        return true;
    }, [repoId, definitionPreviewOwners]);

    // The moment the feature stops being plumbing: with a model in hand and a
    // document behind it, hover/definition/references/completion/signature help
    // become real. The registration is torn down by the editor when the model
    // goes away, and rebuilt when the document is replaced, because a provider
    // outliving its buffer would answer out of a closed document.
    //
    // Both casts narrow the real Monaco namespace to the structural slice the
    // provider module describes; `languageProviders.ts` deliberately carries no
    // runtime Monaco dependency, so this boundary is where the two meet.
    const definitionSupported = supportsFeature(languageDocument.snapshot?.state, 'definition')
        || languageView?.getServerInfos().some(info => supportsFeature(info.state, 'definition')) === true;
    const handleModelMount = useCallback(({ editor, monaco, model }: EditorModelMountContext) => {
        const navigationController = createEditorNavigationController(editor);
        navigationControllerRef.current = navigationController;
        if (rawViewStateRef.current && rawMarkdownRef.current) {
            navigationController.restore(rawViewStateRef.current);
            rawViewStateRef.current = null;
        }
        navigationMountRef.current?.(navigationController);
        const initialLocation = navigationController.capture();
        if (initialLocation) navigationLocationRef.current?.(initialLocation, 'programmatic');
        const navigationListener = navigationController.subscribe((snapshot, reason) => {
            navigationLocationRef.current?.(snapshot, reason);
        });

        if (!languageView) {
            return () => {
                navigationListener.dispose();
                if (navigationControllerRef.current === navigationController) navigationControllerRef.current = null;
                navigationMountRef.current?.(null);
            };
        }
        const definitionOwner = (workspaceId: string) => {
            if (workspaceId === repoId) return { workspaceId: repoId, routingRef };
            const owners = definitionPreviewOwners?.filter(candidate => candidate.workspaceId === workspaceId);
            return owners?.length === 1 ? owners[0] : undefined;
        };
        const loadDefinitionSource = async (
            ownerWorkspaceId: string,
            ownerRoutingRef: string | null | undefined,
            path: string,
            signal: AbortSignal,
        ) => {
            const response = await explorerApi.readBlob(
                ownerWorkspaceId,
                path,
                { signal },
                ownerRoutingRef,
            );
            if (response.encoding !== 'utf-8') {
                throw new Error('Definition source is not readable text.');
            }
            return response.content;
        };
        const modelScopeFor = (workspaceId: string, route: string | null | undefined) =>
            JSON.stringify([workspaceId, route === undefined ? workspaceId : route, editingScope ?? '']);
        const modelScope = modelScopeFor(repoId, routingRef);
        const unregisterModel = registerEditingModel({ scope: modelScope, workspaceId: repoId, path: actualPath, model });
        const identityController = new AbortController();
        const previewSource = registerDefinitionPreviewSource({
            monaco: monaco as unknown as DefinitionPreviewMonaco,
            workspaceId: repoId,
            load: (path, signal) => loadDefinitionSource(repoId, routingRef, path, signal),
            resolveTarget: definitionPreviewOwners
                ? (workspaceId) => {
                    const owner = definitionOwner(workspaceId);
                    return owner
                        ? (path, signal) => loadDefinitionSource(
                            owner.workspaceId,
                            owner.routingRef,
                            path,
                            signal,
                        )
                        : undefined;
                }
                : undefined,
            // clangd answers a jump into `std::string_view` with a libstdc++
            // header. Only the attachment that received that answer holds the
            // capability to read it, so the reader is this document's own view.
            readExternalSource: (resourceId, signal) => languageView.readExternalSource(resourceId, { signal }),
            readExternalSemanticTokens: (resourceId, signal) =>
                languageView.readExternalSemanticTokens(resourceId, { signal }),
            languageForFileName: getMonacoLanguage,
            showUnavailableForRejectedTarget: definitionPreviewOwners !== undefined,
        });
        // Before registering anything, move the model off `typescript` /
        // `javascript` so Monaco's bundled worker stops answering for it. The
        // providers below then register under whichever id the model ended up
        // carrying, which is also the id nothing else provides for.
        const shadow = applyShadowLanguage(monaco as unknown as ShadowMonaco, model);
        const registration = registerLanguageProviders({
            monaco: monaco as unknown as MonacoLike,
            model: model as unknown as ProviderModel,
            view: languageView,
            languageId: shadow?.languageId ?? monacoLanguageId,
            resolveUri: async (uri, signal, target) => {
                try {
                    const document = parseBrowserDocumentUri(uri);
                    if (document) {
                        const owner = definitionOwner(document.workspaceId);
                        if (!owner) throw new Error('Definition owner is unavailable. Retry Go to Definition.');
                        const activeSignal = AbortSignal.any([signal, identityController.signal]);
                        const scope = modelScopeFor(owner.workspaceId, owner.routingRef);
                        const { path, entry } = await resolveEditingTarget(scope, document.path,
                            value => resolveOwnedFile(owner, value, activeSignal), activeSignal);
                        if (entry) {
                            clearIdentityFailure();
                            return allowEditingModelTarget(model, entry, uri.endsWith(`#${SYMBOL_CANDIDATE_FRAGMENT}`));
                        }
                        // Query isolates temporary Peek models by concrete owner/session.
                        const fragment = uri.includes('#') ? uri.slice(uri.indexOf('#')) : '';
                        uri = browserDocumentUri(document.workspaceId, path)
                            + (editingScope !== undefined || owner.routingRef != null
                                ? `?editing=${encodeURIComponent(scope)}` : '') + fragment;
                    }
                    const prepared = await previewSource.prepare(uri, signal, target, target.waitForContent);
                    if (prepared && !signal.aborted && !identityController.signal.aborted) clearIdentityFailure();
                    return prepared ? (monaco as unknown as MonacoLike).Uri.parse(uri) : null;
                } catch (error) {
                    if (!signal.aborted && !identityController.signal.aborted) {
                        setIdentityFailure({
                            message: error instanceof Error ? error.message : 'Cannot confirm file identity.',
                            retry: () => editor.trigger('file-identity', 'editor.action.revealDefinition', null),
                        });
                    }
                    throw error;
                }
            },
        });
        const definitionLinkCue = definitionSupported
            ? installDefinitionLinkCue({
                editor,
                model,
                view: languageView,
                isEnabled: () => supportsFeature(languageView.getSnapshot().state, 'definition')
                    || languageView.getServerInfos().some(info => supportsFeature(info.state, 'definition')),
            })
            : null;
        // Claim the navigations that START in this model, so the global editor
        // opener knows which surface asked and lands the target in its strip.
        const navigation = registerEditorNavigator(model, handleNavigate);
        return () => {
            identityController.abort();
            unregisterModel();
            navigationListener.dispose();
            if (navigationControllerRef.current === navigationController) navigationControllerRef.current = null;
            navigationMountRef.current?.(null);
            definitionLinkCue?.dispose();
            navigation.dispose();
            registration.dispose();
            previewSource.dispose();
            shadow?.revert();
        };
    }, [
        languageView,
        monacoLanguageId,
        handleNavigate,
        definitionSupported,
        repoId,
        routingRef,
        definitionPreviewOwners,
        editingScope,
        actualPath,
    ]);

    const modelShareRef = useRef(onModelShare);
    modelShareRef.current = onModelShare;
    const sharesModel = onModelShare !== undefined;
    const mountModel = displayBlob?.encoding === 'utf-8'
        ? (viewOnly ? mountNonEditableModel : handleModelMount)
        : undefined;
    const editorRef = useRef<EditorModelMountContext['editor'] | null>(null);
    const mountSharedModel = useMemo(() => (mountModel
        ? (context: EditorModelMountContext) => {
            editorRef.current = context.editor;
            const cleanup = mountModel(context);
            if (sharesModel) modelShareRef.current?.(context);
            return () => {
                if (sharesModel) modelShareRef.current?.(null);
                if (editorRef.current === context.editor) editorRef.current = null;
                cleanup?.();
            };
        }
        : undefined
    ), [mountModel, sharesModel]);

    // One editor change feeds two consumers: the render buffer, and the
    // document that the language server sees. Monaco's change list is converted
    // here rather than in the viewer, so the shared viewer stays free of LSP.
    const handleEditorChange = useCallback((
        value: string,
        changes?: readonly monacoEditor.IModelContentChange[],
    ) => {
        if (readOnly || isOversized || isExplorerPathDeleting(ownerKey, actualPath)) return;
        latestEditRef.current = value;
        setExplorerFileDirty(ownerKey, fileInstanceId, actualPath, true);
        recordEdit(value);
        // No change list (a full model reset, or a host that only reports text)
        // means a full-text update, which is what `undefined` asks the store for.
        recordLanguageEdit(value, changes && changes.length > 0 ? toContentChanges(changes) : undefined);
    }, [recordEdit, recordLanguageEdit, readOnly, isOversized, ownerKey, actualPath, fileInstanceId]);

    // `didSave` goes out only after the write actually succeeded — a failed
    // save leaves the buffer dirty and the server's copy unchanged.
    const handleSave = useCallback(async (): Promise<boolean> => {
        const written = latestEditRef.current;
        const ok = await writeFile();
        if (ok) {
            setExplorerFileDirty(ownerKey, fileInstanceId, actualPath, latestEditRef.current !== written);
            setSavedText(written);
            markSaved(written);
        }
        return ok;
    }, [editedContent, writeFile, markSaved, ownerKey, fileInstanceId, actualPath]);
    const switchToRendered = useCallback(() => {
        rawViewStateRef.current = navigationControllerRef.current?.capture() ?? null;
        setRawMarkdown(false);
    }, [setRawMarkdown]);

    // Monaco applies the restored `value` without firing onChange, so the
    // language document gets the full text here.
    const handleDiscard = useCallback(() => {
        setExplorerFileDirty(ownerKey, fileInstanceId, actualPath, false);
        recordLanguageEdit(discardEdits(), undefined);
    }, [discardEdits, recordLanguageEdit, ownerKey, fileInstanceId, actualPath]);

    // Reload from disk. Unsaved edits are only replaced after the user confirms;
    // edits or a save made while the read runs keep the buffer as it is.
    const [reloadPrompt, setReloadPrompt] = useState(false);
    const [reloadNotice, setReloadNotice] = useState<{ message: string; error: boolean } | null>(null);
    const reloadLandedRef = useRef<{ viewState: ReturnType<EditorModelMountContext['editor']['saveViewState']> } | null>(null);
    useEffect(() => {
        setReloadPrompt(false);
        setReloadNotice(null);
        reloadLandedRef.current = null;
    }, [repoId, routingRef, actualPath]);
    const runReload = useCallback(async () => {
        setReloadNotice(null);
        const result = await reload(() => {
            reloadLandedRef.current = { viewState: editorRef.current?.saveViewState() ?? null };
            setRevealRetired(true);
        });
        if (result.kind === 'failed') {
            setReloadNotice({ message: `Could not reload from disk: ${result.message}`, error: true });
        } else if (result.kind === 'edited') {
            setReloadNotice({ message: 'The file was edited or saved during the reload, so your buffer was kept. Reload again to replace it.', error: false });
        }
    }, [reload]);
    const reloadBusy = reloading || reloadPrompt || isSaving || loading;
    const requestReload = useCallback(() => {
        if (reloadBusy) return;
        if (isDirty) {
            setReloadPrompt(true);
            return;
        }
        void runReload();
    }, [reloadBusy, isDirty, runReload]);
    const cancelReload = useCallback(() => setReloadPrompt(false), []);
    const confirmReload = useCallback(() => {
        setReloadPrompt(false);
        void runReload();
    }, [runReload]);
    // After a reload lands in Monaco, put the cursor, selection and scroll back,
    // and hand the language document the disk text as its clean baseline.
    useEffect(() => {
        const landed = reloadLandedRef.current;
        reloadLandedRef.current = null;
        if (!landed) return;
        if (landed.viewState) editorRef.current?.restoreViewState(landed.viewState);
        if (blob?.encoding === 'utf-8') markSaved(blob.content);
        // Runs once per landed blob; `markSaved` is read at that moment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blob]);
    const reloadControlRef = useRef(onReloadControlChange);
    reloadControlRef.current = onReloadControlChange;
    const hostedReload = onReloadControlChange !== undefined;
    useEffect(() => {
        reloadControlRef.current?.({ reload: requestReload, busy: reloadBusy });
    }, [requestReload, reloadBusy]);
    useEffect(() => () => reloadControlRef.current?.(null), [hostedReload]);

    // Surface unsaved-edits state to the owner so a workspace switch can prompt
    // before discarding the buffer (AC-03). Report the current value whenever it
    // flips, and report clean on unmount (file closed / panel torn down).
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);
    useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

    // Same contract for load/error, so the tab strip can show a spinner or a
    // warning for a buffer the user is not currently looking at (AC-05). A
    // closed buffer is neither loading nor errored, hence 'ready' on unmount.
    useEffect(() => {
        onStatusChange?.(status);
    }, [status, onStatusChange]);
    useEffect(() => () => { onStatusChange?.('ready'); }, [onStatusChange]);

    // Publish the save entry point to the owner. The registered function is a
    // stable wrapper around a ref, so re-registering on every keystroke (the
    // handler closes over the edited text) is avoided — the owner keeps one
    // callback per buffer for the whole life of the tab.
    const saveRef = useRef(handleSave);
    saveRef.current = handleSave;
    useEffect(() => {
        if (!onRegisterSave) return;
        if (viewOnly) {
            onRegisterSave(null);
            return;
        }
        onRegisterSave(() => saveRef.current());
        return () => onRegisterSave(null);
    }, [onRegisterSave, viewOnly]);

    const [downloadError, setDownloadError] = useState('');
    const [downloading, setDownloading] = useState(false);
    useEffect(() => setDownloadError(''), [repoId, routingRef, actualPath]);
    const download = async () => {
        setDownloadError('');
        setDownloading(true);
        try {
            const response = await fetch(workspacePreviewUrl(repoId, actualPath, routingRef));
            if (!response.ok) throw new Error(`Download failed (${response.status}).`);
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (err) {
            setDownloadError(err instanceof Error ? err.message : 'Download failed.');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="relative w-full h-full overflow-hidden" data-testid="preview-pane">
            {identityFailure && <div role="alert">{identityFailure.message} <button type="button" onClick={identityFailure.retry}>Retry Go to Definition</button></div>}
            {/* Floating toolbar: close + save controls */}
            {!loading && (
                <div
                    className="absolute top-2 right-6 z-10 flex items-center gap-1.5"
                    data-testid="preview-toolbar"
                >
                    {!isTrusted && (error || isOversized || displayBlob?.encoding === 'base64') && (
                        <button type="button" onClick={download} disabled={downloading}
                            className="text-xs px-2 py-0.5 rounded bg-white dark:bg-[#2d2d2d] border border-[#c8c8c8] dark:border-[#555]"
                            data-testid="preview-download">
                            {downloading ? 'Downloading...' : 'Download'}
                        </button>
                    )}
                    {isDirty && !isTrusted && (
                        <button
                            className="text-[10px] px-2 py-0.5 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors shadow-sm"
                            onClick={handleSave}
                            disabled={isSaving || deleting}
                            data-testid="save-btn"
                        >
                            {isSaving ? 'Saving…' : 'Save'}
                        </button>
                    )}
                    {isDirty && !isTrusted && (
                        <button
                            className="text-[10px] px-2 py-0.5 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f0f0f0] dark:hover:bg-[#3c3c3c] disabled:opacity-50 transition-colors shadow-sm"
                            onClick={handleDiscard}
                            disabled={isSaving || deleting}
                            title="Discard unsaved changes"
                            data-testid="discard-btn"
                        >
                            Discard
                        </button>
                    )}
                    {isDirty && !isTrusted && (
                        <span className="w-2 h-2 rounded-full bg-[#f59e0b] flex-shrink-0" title="Unsaved changes" data-testid="dirty-indicator" />
                    )}
                    {!hostedReload && !error && (
                        <ReloadFromDiskButton onReload={requestReload} busy={reloadBusy} />
                    )}
                    {canPreviewMarkdown && (
                        <div role="group" aria-label="Markdown view" className="flex rounded border border-[#bcbcbc] bg-[#fafafa] text-xs dark:border-[#555] dark:bg-[#252525]">
                            {(['Rendered', 'Raw'] as const).map(mode => (
                                <button
                                    key={mode}
                                    type="button"
                                    aria-pressed={(mode === 'Rendered') === showRendered}
                                    onClick={mode === 'Rendered' ? switchToRendered : () => setRawMarkdown(true)}
                                    className={`rounded px-2 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4] ${
                                        (mode === 'Rendered') === showRendered
                                            ? 'bg-[#0078d4] text-white'
                                            : 'text-[#555] hover:bg-black/5 dark:text-[#ccc] dark:hover:bg-white/10'
                                    }`}
                                >
                                    {mode}
                                </button>
                            ))}
                        </div>
                    )}
                    {onClose && (
                        <button
                            className="w-5 h-5 flex items-center justify-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/5 dark:hover:bg-white/10 text-sm transition-colors"
                            onClick={onClose}
                            title="Close preview"
                            data-testid="preview-close-btn"
                        >
                            ×
                        </button>
                    )}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center gap-2 h-full text-xs text-[#848484]" data-testid="preview-loading">
                    <Spinner size="sm" /> Loading {fileName}…
                </div>
            ) : error ? (
                <div className="flex items-center gap-2 px-4 py-4" data-testid="preview-error">
                    <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                    <Button variant="secondary" size="sm" onClick={retry} data-testid="preview-retry-btn">Retry</Button>
                </div>
            ) : displayBlob ? (
                showRendered ? <RenderedMarkdown content={displayBlob.content} /> :
                <FileViewer
                    selectionContext={readOnly ? undefined : {
                        workspaceId: repoId,
                        filePath: actualPath,
                        destinationId: routingRef ?? repoId,
                    }}
                    blob={displayBlob}
                    fileName={fileName}
                    onChange={handleEditorChange}
                    readOnly={viewOnly}
                    onSave={viewOnly ? undefined : handleSave}
                    markdown={isWorkspacePreview && !canPreviewMarkdown ? 'toggle' : 'off'}
                    revealLine={revealRetired ? undefined : revealLine}
                    highlightRange={!revealRetired && endLine !== undefined && displayBlob.encoding === 'utf-8'
                        ? resolveLineRange(revealLine, endLine, toLines(displayBlob.content).length) : null}
                    revealColumn={revealColumn}
                    revealNonce={revealNonce}
                    markers={languageEnabled ? languageDocument.markers : undefined}
                    onModelMount={mountSharedModel}
                    codeTestId="monaco-container"
                />
            ) : null}
            {!loading && !error && isOversized && (
                <div className="absolute bottom-1 left-3 text-xs text-[#848484]" data-testid="preview-oversized">
                    File exceeds 10 MB; showing a truncated, read-only preview.
                </div>
            )}
            {reloadNotice && (
                <div
                    role={reloadNotice.error ? 'alert' : 'status'}
                    className={`absolute left-3 right-3 top-9 z-20 flex items-start gap-2 rounded border px-2 py-1 text-xs shadow-sm ${
                        reloadNotice.error
                            ? 'border-[#f1b8ad] bg-[#fdf0ee] text-[#a1260d] dark:border-[#5a1d1d] dark:bg-[#3a1d1d] dark:text-[#f48771]'
                            : 'border-[#c8c8c8] bg-white text-[#1e1e1e] dark:border-[#555] dark:bg-[#2d2d2d] dark:text-[#cccccc]'
                    }`}
                    data-testid="file-reload-notice"
                >
                    <span className="min-w-0 flex-1">{reloadNotice.message}</span>
                    <button
                        type="button"
                        aria-label="Dismiss"
                        className="flex-shrink-0 rounded px-1 hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => setReloadNotice(null)}
                    >
                        ×
                    </button>
                </div>
            )}
            {reloadPrompt && (
                <UnifiedPanelCloseConfirm
                    label="Confirm reload"
                    message={`Reload ${fileName} from disk? Your unsaved changes will be lost.`}
                    confirmLabel="Discard and reload"
                    onCancel={cancelReload}
                    onConfirm={confirmReload}
                />
            )}
            {downloadError && <div role="alert" className="absolute bottom-2 left-2 text-xs text-red-600">{downloadError}</div>}

            {!loading && !error && languageEnabled && (
                <div className="absolute bottom-1 right-3 z-10 max-w-[70%] pointer-events-none">
                    <LanguageStatusBadge
                        snapshot={languageDocument.snapshot}
                        onRestart={restartLanguageServer}
                        variant="corner"
                    />
                </div>
            )}
            {!loading && !error && symbolCandidate && (
                <div
                    className="absolute bottom-1 left-3 z-10 rounded border border-amber-500/50 bg-amber-100/95 px-2 py-0.5 text-[10px] font-medium text-amber-900 shadow-sm dark:bg-amber-950/95 dark:text-amber-200"
                    title="This file was opened from a repository symbol candidate that clangd did not confirm."
                    data-testid="symbol-candidate-badge"
                >
                    Symbol candidate
                </div>
            )}
        </div>
    );
}
