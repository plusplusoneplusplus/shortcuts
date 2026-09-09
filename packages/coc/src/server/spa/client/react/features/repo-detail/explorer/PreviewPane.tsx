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
 * editor has a model, this is also where the Monaco language providers are
 * registered over the document — one registration per model, disposed with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { Spinner, Button } from '../../../ui';
import { FileViewer } from '../../../shared/file-viewer/FileViewer';
import { getMonacoLanguage, type EditorModelMountContext } from '../../../shared/file-viewer/MonacoFileEditor';
import { useFileContent } from '../../../shared/file-viewer/useFileContent';
import { toContentChanges } from '../../language-servers/monacoBridge';
import { useLanguageDocument } from '../../language-servers/useLanguageDocument';
import {
    registerLanguageProviders,
    type MonacoLike,
    type ProviderModel,
} from '../../language-servers/languageProviders';
import { TRUSTED_PATH_PREFIX } from './ExactOpen';
import { explorerApi } from './explorerApi';

export interface PreviewPaneProps {
    repoId: string;
    /** Relative path from repo root, or prefixed with TRUSTED_PATH_PREFIX for absolute paths */
    filePath: string;
    /** File name for language detection, e.g. "index.ts" */
    fileName: string;
    /**
     * One-based line to scroll to and highlight once the content is loaded. Set
     * when the file is opened from a content-search hit.
     */
    revealLine?: number;
    onClose?: () => void;
    /** When true the editor is non-editable and save/dirty UI is suppressed. */
    readOnly?: boolean;
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
}

/** What a buffer is doing, as reported to its owner through `onStatusChange`. */
export type PreviewStatus = 'loading' | 'error' | 'ready';

export function PreviewPane({ repoId, filePath, fileName, revealLine, onClose, readOnly, onDirtyChange, onRegisterSave, onStatusChange, onNotFound }: PreviewPaneProps) {
    const isTrusted = filePath.startsWith(TRUSTED_PATH_PREFIX);
    const actualPath = isTrusted ? filePath.slice(TRUSTED_PATH_PREFIX.length) : filePath;
    const effectiveReadOnly = readOnly || isTrusted;

    const read = useCallback((signal: AbortSignal) => (
        isTrusted
            ? explorerApi.readTrustedBlob(actualPath, { signal })
            : explorerApi.readBlob(repoId, actualPath, { signal })
    ), [actualPath, isTrusted, repoId]);

    const write = useMemo(() => (
        effectiveReadOnly ? undefined : (content: string) => explorerApi.writeBlob(repoId, actualPath, content).then(() => undefined)
    ), [effectiveReadOnly, repoId, actualPath]);

    const handleNotFound = useCallback((err: Error) => {
        if ((err as { status?: number }).status === 404) onNotFound?.();
    }, [onNotFound]);

    const {
        blob, displayBlob, isOversized, loading, error, status, retry,
        isDirty, isSaving, editedContent, onChange: recordEdit, save: writeFile,
    } = useFileContent({
        key: `${isTrusted ? 'trusted' : repoId}:${actualPath}`,
        read,
        write,
        onError: handleNotFound,
    });

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
    const languageEnabled = !isTrusted && !loading && !error
        && blob?.encoding === 'utf-8' && !isOversized;

    const languageDocument = useLanguageDocument({
        workspaceId: repoId,
        path: actualPath,
        enabled: languageEnabled,
        text: savedText ?? diskText,
        fallbackLanguageId: getMonacoLanguage(fileName),
    });
    const { handleChange: recordLanguageEdit, markSaved, view: languageView } = languageDocument;

    // The Monaco language the editor will actually use for this file, so the
    // providers are registered under the same id the model carries.
    const monacoLanguageId = getMonacoLanguage(fileName);

    // The moment the feature stops being plumbing: with a model in hand and a
    // document behind it, hover/definition/references/completion/signature help
    // become real. The registration is torn down by the editor when the model
    // goes away, and rebuilt when the document is replaced, because a provider
    // outliving its buffer would answer out of a closed document.
    //
    // Both casts narrow the real Monaco namespace to the structural slice the
    // provider module describes; `languageProviders.ts` deliberately carries no
    // runtime Monaco dependency, so this boundary is where the two meet.
    const handleModelMount = useCallback(({ monaco, model }: EditorModelMountContext) => {
        if (!languageView) return;
        const registration = registerLanguageProviders({
            monaco: monaco as unknown as MonacoLike,
            model: model as unknown as ProviderModel,
            view: languageView,
            languageId: monacoLanguageId,
        });
        return () => registration.dispose();
    }, [languageView, monacoLanguageId]);

    // One editor change feeds two consumers: the render buffer, and the
    // document that the language server sees. Monaco's change list is converted
    // here rather than in the viewer, so the shared viewer stays free of LSP.
    const handleEditorChange = useCallback((
        value: string,
        changes?: readonly monacoEditor.IModelContentChange[],
    ) => {
        recordEdit(value);
        // No change list (a full model reset, or a host that only reports text)
        // means a full-text update, which is what `undefined` asks the store for.
        recordLanguageEdit(value, changes && changes.length > 0 ? toContentChanges(changes) : undefined);
    }, [recordEdit, recordLanguageEdit]);

    // `didSave` goes out only after the write actually succeeded — a failed
    // save leaves the buffer dirty and the server's copy unchanged.
    const handleSave = useCallback(async (): Promise<boolean> => {
        const written = editedContent;
        const ok = await writeFile();
        if (ok) {
            setSavedText(written);
            markSaved(written);
        }
        return ok;
    }, [editedContent, writeFile, markSaved]);

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
        if (effectiveReadOnly) {
            onRegisterSave(null);
            return;
        }
        onRegisterSave(() => saveRef.current());
        return () => onRegisterSave(null);
    }, [onRegisterSave, effectiveReadOnly]);

    return (
        <div className="relative w-full h-full overflow-hidden" data-testid="preview-pane">
            {/* Floating toolbar: close + save controls */}
            {!loading && !error && (
                <div
                    className="absolute top-2 right-6 z-10 flex items-center gap-1.5"
                    data-testid="preview-toolbar"
                >
                    {isDirty && !effectiveReadOnly && (
                        <button
                            className="text-[10px] px-2 py-0.5 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors shadow-sm"
                            onClick={handleSave}
                            disabled={isSaving}
                            data-testid="save-btn"
                        >
                            {isSaving ? 'Saving…' : 'Save'}
                        </button>
                    )}
                    {isDirty && !effectiveReadOnly && (
                        <span className="w-2 h-2 rounded-full bg-[#f59e0b] flex-shrink-0" title="Unsaved changes" data-testid="dirty-indicator" />
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
                <FileViewer
                    blob={displayBlob}
                    fileName={fileName}
                    readOnly={effectiveReadOnly}
                    onChange={handleEditorChange}
                    onSave={effectiveReadOnly ? undefined : handleSave}
                    revealLine={revealLine}
                    markers={languageEnabled ? languageDocument.markers : undefined}
                    onModelMount={languageEnabled && languageView ? handleModelMount : undefined}
                    codeTestId="monaco-container"
                />
            ) : null}
        </div>
    );
}
