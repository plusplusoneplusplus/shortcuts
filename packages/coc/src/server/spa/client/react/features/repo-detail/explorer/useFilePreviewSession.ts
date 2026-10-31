/**
 * useFilePreviewSession — one `PreviewPane` file's transaction owner.
 *
 * It owns the transport for the exact `FilePreviewIdentity`, the
 * `useFileContent` buffer, editability, Explorer dirty publication, the clean
 * baseline the language document sees, save/discard/reload transitions, the
 * Markdown raw/rendered mode and reveal retirement, and the owner's
 * dirty/status/save/reload registrations. A new identity is the only session
 * boundary: it restarts the buffer and resets every per-file transient here.
 *
 * Model-attached resources (providers, definition preview, navigation capture)
 * live in `usePreviewModelAttachment`; this hook hands it the refs it needs.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import {
    getMonacoLanguage,
    type EditorModelMountContext,
    type EditorNavigationController,
    type EditorNavigationReason,
    type EditorNavigationSnapshot,
} from '../../../shared/file-viewer/MonacoFileEditor';
import { useFileContent } from '../../../shared/file-viewer/useFileContent';
import { toContentChanges } from '../../language-servers/monacoBridge';
import { useLanguageDocument } from '../../language-servers/useLanguageDocument';
import { createFilePreviewTransport, type FilePreviewIdentity } from './filePreviewIdentity';
import { isExplorerPathDeleting, setExplorerFileDirty, useIsExplorerPathDeleting } from './explorerDirtyStore';

/** What a host needs to render the "Reload from disk" button for this pane. */
export interface FileReloadControl {
    reload: () => void;
    busy: boolean;
}

/** What a buffer is doing, as reported to its owner through `onStatusChange`. */
export type PreviewStatus = 'loading' | 'error' | 'ready';

/** A cross-file jump the host should open in its own tab strip. */
export interface PreviewNavigateTarget {
    workspaceId?: string;
    routingRef?: string | null;
    path: string;
    name: string;
    line: number;
    column: number;
    symbolCandidate?: true;
}

/** A jump outside every workspace, carried by the host's opaque capability. */
export interface PreviewExternalNavigateTarget {
    resourceId: string;
    name: string;
    line: number;
    column: number;
}

/**
 * Everything a pane reports to, or registers with, its owner. Each handle is
 * released on unmount or when the pane stops offering it; see `PreviewPaneProps`
 * for the per-callback contract.
 */
export interface FilePreviewHostBridge {
    onDirtyChange?: (isDirty: boolean) => void;
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
    onStatusChange?: (status: PreviewStatus) => void;
    onNotFound?: () => void;
    onReloadControlChange?: (control: FileReloadControl | null) => void;
    onNavigate?: (target: PreviewNavigateTarget) => void;
    onNavigateExternal?: (target: PreviewExternalNavigateTarget) => void;
    onNavigationMount?: (controller: EditorNavigationController | null) => void;
    onNavigationLocation?: (snapshot: EditorNavigationSnapshot, reason: EditorNavigationReason) => void;
    onModelShare?: (context: EditorModelMountContext | null) => void;
}

export interface PreviewReveal {
    line?: number;
    endLine?: number;
    column?: number;
    nonce?: number;
}

export function useFilePreviewSession({ identity, fileName, markdownPreview, reveal, rawSource, host }: {
    identity: FilePreviewIdentity;
    fileName: string;
    markdownPreview: boolean;
    reveal: PreviewReveal;
    /** A new value asks for the raw editor (see `PreviewPaneProps.rawSource`). */
    rawSource?: number;
    host: FilePreviewHostBridge;
}) {
    const { workspaceId, routingRef, editingScope, path, ownerKey, readOnly } = identity;
    const fileInstanceId = useId();
    const deleting = useIsExplorerPathDeleting(ownerKey, path);

    const transport = useMemo(() => createFilePreviewTransport(identity), [identity]);
    const { onNotFound } = host;
    const handleNotFound = useCallback((err: Error) => {
        if ((err as { status?: number }).status === 404) onNotFound?.();
    }, [onNotFound]);

    const content = useFileContent({
        key: identity.contentKey,
        read: transport.read,
        write: transport.write,
        onError: handleNotFound,
    });
    const {
        blob, displayBlob, isOversized, loading, error, status, reload, reloading,
        isDirty, isSaving, editedContent, onChange: recordEdit, save: writeFile, discard: discardEdits,
    } = content;

    const viewOnly = readOnly || isOversized || deleting;
    const latestEditRef = useRef(editedContent);
    latestEditRef.current = editedContent;
    useEffect(() => {
        setExplorerFileDirty(ownerKey, fileInstanceId, path, !readOnly && isDirty);
    }, [ownerKey, fileInstanceId, path, readOnly, isDirty]);
    useEffect(() => () => setExplorerFileDirty(ownerKey, fileInstanceId, path, false),
        [ownerKey, fileInstanceId, path]);

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
    const languageDocument = useLanguageDocument({
        workspaceId,
        routingRef,
        editingScope,
        path,
        enabled: languageEnabled,
        text: savedText ?? diskText,
        fallbackLanguageId: getMonacoLanguage(fileName),
    });
    const { handleChange: recordLanguageEdit, markSaved } = languageDocument;

    // Live editor handles, set by the model mount and read by view transitions.
    const editorRef = useRef<EditorModelMountContext['editor'] | null>(null);
    const navigationControllerRef = useRef<EditorNavigationController | null>(null);

    // ── Markdown raw/rendered mode ──────────────────────────────────────────
    const canPreviewMarkdown = markdownPreview && identity.kind !== 'trusted' && !isOversized
        && displayBlob?.encoding === 'utf-8' && /\.(md|markdown)$/i.test(fileName);
    const startsRaw = reveal.line !== undefined || rawSource !== undefined;
    const [rawMarkdown, setRawMarkdownState] = useState(startsRaw);
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
        if (reveal.line === undefined) return;
        rawViewStateRef.current = null;
        setRawMarkdown(true);
    }, [reveal.line, reveal.column, reveal.nonce, setRawMarkdown]);
    useEffect(() => {
        if (rawSource === undefined) return;
        rawViewStateRef.current = null;
        setRawMarkdown(true);
    }, [rawSource, setRawMarkdown]);
    useEffect(() => {
        rawViewStateRef.current = null;
        setRawMarkdown(startsRaw);
    }, [workspaceId, routingRef, path, setRawMarkdown]);
    const showRendered = canPreviewMarkdown && !rawMarkdown;
    /** Restores the raw editor view saved when the reader left for Rendered. */
    const restoreRawView = useCallback((controller: EditorNavigationController) => {
        if (rawViewStateRef.current && rawMarkdownRef.current) {
            controller.restore(rawViewStateRef.current);
            rawViewStateRef.current = null;
        }
    }, []);
    const switchToRendered = useCallback(() => {
        rawViewStateRef.current = navigationControllerRef.current?.capture() ?? null;
        setRawMarkdown(false);
    }, [setRawMarkdown]);
    const renderedNavigationController = useMemo<EditorNavigationController>(() => ({
        capture: () => rawViewStateRef.current,
        restore: snapshot => {
            rawViewStateRef.current = snapshot;
            setRawMarkdown(true);
        },
        subscribe: () => ({ dispose: () => undefined }),
    }), [setRawMarkdown]);
    const { onNavigationMount } = host;
    useEffect(() => {
        if (!showRendered || !onNavigationMount) return;
        onNavigationMount(renderedNavigationController);
        return () => onNavigationMount(null);
    }, [showRendered, onNavigationMount, renderedNavigationController]);

    // A reload keeps the reader where they were, so the opening reveal and its
    // highlight must not re-run over the new text. The next navigation here
    // brings them back.
    const [revealRetired, setRevealRetired] = useState(false);
    useEffect(() => { setRevealRetired(false); },
        [reveal.line, reveal.endLine, reveal.column, reveal.nonce, workspaceId, routingRef, path]);

    // ── Edit / save / discard ───────────────────────────────────────────────
    // One editor change feeds two consumers: the render buffer, and the
    // document that the language server sees. Monaco's change list is converted
    // here rather than in the viewer, so the shared viewer stays free of LSP.
    const handleEditorChange = useCallback((
        value: string,
        changes?: readonly monacoEditor.IModelContentChange[],
    ) => {
        if (readOnly || isOversized || isExplorerPathDeleting(ownerKey, path)) return;
        latestEditRef.current = value;
        setExplorerFileDirty(ownerKey, fileInstanceId, path, true);
        recordEdit(value);
        // No change list (a full model reset, or a host that only reports text)
        // means a full-text update, which is what `undefined` asks the store for.
        recordLanguageEdit(value, changes && changes.length > 0 ? toContentChanges(changes) : undefined);
    }, [recordEdit, recordLanguageEdit, readOnly, isOversized, ownerKey, path, fileInstanceId]);

    // `didSave` goes out only after the write actually succeeded — a failed
    // save leaves the buffer dirty and the server's copy unchanged. Only the
    // written text becomes the clean baseline; an edit made during the write
    // stays dirty.
    const handleSave = useCallback(async (): Promise<boolean> => {
        const written = latestEditRef.current;
        const ok = await writeFile();
        if (ok) {
            setExplorerFileDirty(ownerKey, fileInstanceId, path, latestEditRef.current !== written);
            setSavedText(written);
            markSaved(written);
        }
        return ok;
    }, [writeFile, markSaved, ownerKey, fileInstanceId, path]);

    // Monaco applies the restored `value` without firing onChange, so the
    // language document gets the full text here.
    const handleDiscard = useCallback(() => {
        setExplorerFileDirty(ownerKey, fileInstanceId, path, false);
        recordLanguageEdit(discardEdits(), undefined);
    }, [discardEdits, recordLanguageEdit, ownerKey, fileInstanceId, path]);

    // ── Reload from disk ────────────────────────────────────────────────────
    // Unsaved edits are only replaced after the user confirms; edits or a save
    // made while the read runs keep the buffer as it is.
    const [reloadPrompt, setReloadPrompt] = useState(false);
    const [reloadNotice, setReloadNotice] = useState<{ message: string; error: boolean } | null>(null);
    const reloadLandedRef = useRef<{ viewState: ReturnType<EditorModelMountContext['editor']['saveViewState']> } | null>(null);
    useEffect(() => {
        setReloadPrompt(false);
        setReloadNotice(null);
        reloadLandedRef.current = null;
    }, [workspaceId, routingRef, path]);
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
    const dismissReloadNotice = useCallback(() => setReloadNotice(null), []);
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

    // ── Owner registrations ─────────────────────────────────────────────────
    const { onReloadControlChange, onDirtyChange, onStatusChange, onRegisterSave } = host;
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

    return {
        content,
        deleting,
        viewOnly,
        languageEnabled,
        languageDocument,
        editorRef,
        navigationControllerRef,
        markdown: {
            canPreview: canPreviewMarkdown,
            showRendered,
            showRaw: () => setRawMarkdown(true),
            showRenderedView: switchToRendered,
            restoreRawView,
        },
        revealRetired,
        handleEditorChange,
        handleSave,
        handleDiscard,
        reloadControl: {
            hosted: hostedReload,
            busy: reloadBusy,
            request: requestReload,
            prompt: reloadPrompt,
            cancel: cancelReload,
            confirm: confirmReload,
            notice: reloadNotice,
            dismissNotice: dismissReloadNotice,
        },
    };
}

export type FilePreviewSession = ReturnType<typeof useFilePreviewSession>;
