/**
 * PreviewPane — renders file content using a full-bleed Monaco Editor.
 *
 * The right panel is entirely the Monaco editor for text files, with
 * minimal floating controls for close/save. Non-text content (images, binary)
 * falls back to simple centered displays.
 *
 * Fetches blob content from the API and supports loading/error/retry states.
 * Cancels in-flight requests when the file path changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner, Button } from '../../../ui';
import { MonacoFileEditor, getMonacoLanguage } from './MonacoFileEditor';
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

interface BlobResponse {
    content: string;
    encoding: 'utf-8' | 'base64';
    mimeType: string;
}

const MAX_PREVIEW_SIZE = 512 * 1024; // 512 KB

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PreviewPane({ repoId, filePath, fileName, revealLine, onClose, readOnly, onDirtyChange, onRegisterSave, onStatusChange, onNotFound }: PreviewPaneProps) {
    const isTrusted = filePath.startsWith(TRUSTED_PATH_PREFIX);
    const actualPath = isTrusted ? filePath.slice(TRUSTED_PATH_PREFIX.length) : filePath;
    const effectiveReadOnly = readOnly || isTrusted;

    const [blob, setBlob] = useState<BlobResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState<string>('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    // Ref so a changing callback identity never re-triggers the fetch effect.
    const onNotFoundRef = useRef(onNotFound);
    onNotFoundRef.current = onNotFound;

    const fetchBlob = useCallback((signal: AbortSignal) => (
        isTrusted
            ? explorerApi.readTrustedBlob(actualPath, { signal })
            : explorerApi.readBlob(repoId, actualPath, { signal })
    ), [actualPath, isTrusted, repoId]);

    // Fetch blob on mount or path change; cancel in-flight on change
    useEffect(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        setBlob(null);
        setIsDirty(false);
        setEditedContent('');

        fetchBlob(controller.signal)
            .then((data: BlobResponse) => {
                if (!controller.signal.aborted) {
                    setBlob(data);
                    if (data.encoding === 'utf-8') {
                        setEditedContent(data.content);
                    }
                }
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) {
                    setError(err.message || 'Failed to load file');
                    if ((err as { status?: number }).status === 404) onNotFoundRef.current?.();
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [fetchBlob]);

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
        onStatusChange?.(loading ? 'loading' : error ? 'error' : 'ready');
    }, [loading, error, onStatusChange]);
    useEffect(() => () => { onStatusChange?.('ready'); }, [onStatusChange]);

    const doRetry = () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError(null);
        setBlob(null);
        setIsDirty(false);
        setEditedContent('');
        fetchBlob(controller.signal)
            .then((data: BlobResponse) => {
                if (!controller.signal.aborted) {
                    setBlob(data);
                    if (data.encoding === 'utf-8') {
                        setEditedContent(data.content);
                    }
                }
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) {
                    setError(err.message || 'Failed to load file');
                    if ((err as { status?: number }).status === 404) onNotFoundRef.current?.();
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
    };

    const handleEditorChange = useCallback((value: string) => {
        if (effectiveReadOnly) return;
        setEditedContent(value);
        setIsDirty(true);
    }, [effectiveReadOnly]);

    const handleSave = useCallback(async (): Promise<boolean> => {
        if (isTrusted) return false; // never save trusted files
        setIsSaving(true);
        try {
            await explorerApi.writeBlob(repoId, actualPath, editedContent);
            setIsDirty(false);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [repoId, actualPath, editedContent, isTrusted]);

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

    const isImage = blob?.encoding === 'base64' && blob.mimeType.startsWith('image/');
    const isBinary = blob?.encoding === 'base64' && !isImage;
    const isOversized = blob?.encoding === 'utf-8' && blob.content.length > MAX_PREVIEW_SIZE;
    const isText = blob?.encoding === 'utf-8';

    const displayContent = useMemo(() => {
        if (!blob || blob.encoding !== 'utf-8') return '';
        if (isOversized) return blob.content.slice(0, MAX_PREVIEW_SIZE);
        return blob.content;
    }, [blob, isOversized]);

    const monacoLanguage = useMemo(
        () => getMonacoLanguage(fileName),
        [fileName],
    );

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
                    <Button variant="secondary" size="sm" onClick={doRetry} data-testid="preview-retry-btn">Retry</Button>
                </div>
            ) : isImage ? (
                <div className="flex items-center justify-center p-4 h-full" data-testid="preview-image">
                    <img
                        src={`data:${blob!.mimeType};base64,${blob!.content}`}
                        alt={fileName}
                        className="max-w-full max-h-[80vh] object-contain"
                    />
                </div>
            ) : isBinary ? (
                <div className="flex flex-col items-center justify-center gap-2 h-full text-sm text-[#848484]" data-testid="preview-binary">
                    <span className="text-2xl">📄</span>
                    <span>Binary file — {formatFileSize(blob!.content.length)} bytes</span>
                </div>
            ) : isText ? (
                <div className="h-full w-full" data-testid="monaco-container">
                    <MonacoFileEditor
                        value={isOversized ? displayContent : editedContent}
                        language={monacoLanguage}
                        onChange={handleEditorChange}
                        onSave={effectiveReadOnly ? undefined : handleSave}
                        readOnly={effectiveReadOnly}
                        revealLine={revealLine}
                    />
                </div>
            ) : null}
        </div>
    );
}
