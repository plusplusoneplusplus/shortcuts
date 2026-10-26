/**
 * useFileContent — the fetch/edit state machine a file viewer needs: abort and
 * refetch on `key` change, loading/error/retry, the 10 MB UTF-8 oversize cut, and
 * the edit buffer. Transport is injected, so no endpoint leaks in here. Host
 * callback plumbing (`onDirtyChange`/`onStatusChange`/`onRegisterSave`) stays
 * with the host as thin effects over the values returned here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileBlob, FileViewerStatus } from './types';

/** UTF-8 byte limit; text past this is shown truncated and view-only. */
export const MAX_FILE_VIEW_SIZE = 10 * 1024 * 1024; // 10 MB

export interface UseFileContentOptions {
    /**
     * Identity of the file being viewed. Changing it aborts any in-flight read
     * and starts a fresh one, discarding the previous edit buffer.
     *
     * `null` means "there is nothing to read (yet)": no request is issued and
     * the buffer sits in `loading`. Hosts that resolve a target before they can
     * fetch use it for the not-yet-resolvable case.
     */
    key: string | null;
    /** Reads the file. Rejections surface as `error`; aborts are ignored. */
    read: (signal: AbortSignal) => Promise<FileBlob>;
    /** Writes the edit buffer back. Omit for a read-only buffer. */
    write?: (content: string) => Promise<void>;
    /** Called on a failed read (never on abort), before `error` is shown. */
    onError?: (err: Error) => void;
}

/**
 * How a `reload` ended. Only `reloaded` replaced the buffer; every other
 * outcome left the text on screen untouched.
 *
 *  - `edited` — the buffer was edited or saved while the read was in flight,
 *    so the read may be older than what the user has.
 *  - `failed` — the read was rejected; `message` says why.
 *  - `stale` — the file identity changed, the hook unmounted, or another
 *    reload/save was already running.
 */
export type FileReloadResult =
    | { kind: 'reloaded' }
    | { kind: 'edited' }
    | { kind: 'failed'; message: string }
    | { kind: 'stale' };

export interface UseFileContent {
    /** The bytes as read, before truncation or edits. */
    blob: FileBlob | null;
    /** What to render: the edit buffer, or the 10 MB UTF-8 prefix when oversized. */
    displayBlob: FileBlob | null;
    isOversized: boolean;
    loading: boolean;
    error: string | null;
    status: FileViewerStatus;
    retry: () => void;
    /**
     * Re-reads the same file in place, keeping the current buffer on screen
     * until the new bytes arrive. Replaces unsaved edits made BEFORE the call
     * (the host confirms that), never ones made while the read runs.
     * `beforeApply` runs right before the buffer is replaced. Without a loaded
     * blob this is a plain `retry`.
     */
    reload: (beforeApply?: () => void) => Promise<FileReloadResult>;
    /** True while a `reload` read is in flight. */
    reloading: boolean;
    editedContent: string;
    isDirty: boolean;
    isSaving: boolean;
    /** Records an edit. No-op when the buffer has no `write`. */
    onChange: (value: string) => void;
    /** Resolves true only when the write succeeded. */
    save: () => Promise<boolean>;
    /** Drops unsaved edits, restoring the last read or saved text, and returns it. */
    discard: () => string;
}

export function useFileContent({ key, read, write, onError }: UseFileContentOptions): UseFileContent {
    const [blob, setBlob] = useState<FileBlob | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [reloading, setReloading] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    // Refs so changing callback identities never re-trigger the fetch.
    const readRef = useRef(read);
    readRef.current = read;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const writeRef = useRef(write);
    writeRef.current = write;
    // The text on disk as far as this buffer knows: the read, then each successful write.
    const savedContentRef = useRef('');
    const editRevisionRef = useRef(0);
    const editedContentRef = useRef('');
    const savingRef = useRef(false);
    // Bumped by every save, so a reload can tell a write raced its read.
    const saveRevisionRef = useRef(0);
    const reloadingRef = useRef(false);
    const blobRef = useRef(blob);
    blobRef.current = blob;
    // Encode only when the read blob changes, never on each editor keystroke.
    const textPreview = useMemo(() => {
        if (blob?.encoding !== 'utf-8') return null;
        const bytes = new TextEncoder().encode(blob.content);
        if (bytes.length <= MAX_FILE_VIEW_SIZE) return { content: blob.content, isOversized: false };
        // Streaming decode drops an incomplete trailing code point instead of
        // inserting a replacement character or splitting a surrogate pair.
        const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(0, MAX_FILE_VIEW_SIZE), { stream: true });
        return { content, isOversized: true };
    }, [blob]);
    const isOversized = textPreview?.isOversized ?? false;
    const canWrite = write !== undefined && !isOversized;

    const load = useCallback(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        setBlob(null);
        // A fresh read retires any reload in flight; its answer is now stale.
        reloadingRef.current = false;
        setReloading(false);
        setIsDirty(false);
        setEditedContent('');
        savedContentRef.current = '';
        editedContentRef.current = '';
        editRevisionRef.current++;

        // No target to read — stay in `loading` without touching the transport.
        if (key === null) {
            return controller;
        }

        readRef.current(controller.signal)
            .then((data) => {
                if (!controller.signal.aborted) {
                    setBlob(data);
                    if (data.encoding === 'utf-8') {
                        setEditedContent(data.content);
                        savedContentRef.current = data.content;
                        editedContentRef.current = data.content;
                    }
                }
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) {
                    setError(err.message || 'Failed to load file');
                    onErrorRef.current?.(err);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return controller;
    }, [key]);

    useEffect(() => {
        const controller = load();
        return () => controller.abort();
        // `key` is the file identity; `load` only changes when it does.
    }, [key, load]);

    const onChange = useCallback((value: string) => {
        if (!canWrite) return;
        editRevisionRef.current++;
        editedContentRef.current = value;
        setEditedContent(value);
        setIsDirty(true);
    }, [canWrite]);

    const save = useCallback(async (): Promise<boolean> => {
        const writeFn = writeRef.current;
        if (!writeFn || !canWrite || savingRef.current) return false;
        const content = editedContentRef.current;
        const revision = editRevisionRef.current;
        const readController = abortRef.current;
        savingRef.current = true;
        saveRevisionRef.current++;
        setIsSaving(true);
        try {
            await writeFn(content);
            if (readController !== abortRef.current || readController?.signal.aborted) return false;
            savedContentRef.current = content;
            setIsDirty(editRevisionRef.current !== revision);
            return true;
        } catch (err) {
            if (readController === abortRef.current && !readController?.signal.aborted) {
                setError(err instanceof Error ? err.message : 'Save failed');
            }
            return false;
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    }, [editedContent, canWrite]);

    const reload = useCallback(async (beforeApply?: () => void): Promise<FileReloadResult> => {
        const readController = abortRef.current;
        if (key === null || !readController || readController.signal.aborted) return { kind: 'stale' };
        if (reloadingRef.current || savingRef.current) return { kind: 'stale' };
        if (blobRef.current === null) {
            load();
            return { kind: 'reloaded' };
        }
        const editRevision = editRevisionRef.current;
        const saveRevision = saveRevisionRef.current;
        // A key change, `retry` or unmount aborts this controller; the reload
        // shares it, so a late answer for an old file is never applied.
        const current = () => readController === abortRef.current && !readController.signal.aborted;
        reloadingRef.current = true;
        setReloading(true);
        try {
            const data = await readRef.current(readController.signal);
            if (!current()) return { kind: 'stale' };
            if (editRevisionRef.current !== editRevision || saveRevisionRef.current !== saveRevision) {
                return { kind: 'edited' };
            }
            beforeApply?.();
            setBlob(data);
            setError(null);
            const text = data.encoding === 'utf-8' ? data.content : '';
            setEditedContent(text);
            savedContentRef.current = text;
            editedContentRef.current = text;
            editRevisionRef.current++;
            setIsDirty(false);
            return { kind: 'reloaded' };
        } catch (err) {
            if (!current()) return { kind: 'stale' };
            const error = err instanceof Error ? err : new Error(String(err));
            onErrorRef.current?.(error);
            return { kind: 'failed', message: error.message || 'Failed to reload file' };
        } finally {
            if (readController === abortRef.current) {
                reloadingRef.current = false;
                setReloading(false);
            }
        }
    }, [key, load]);

    const discard = useCallback((): string => {
        const saved = savedContentRef.current;
        editRevisionRef.current++;
        editedContentRef.current = saved;
        setEditedContent(saved);
        setIsDirty(false);
        return saved;
    }, []);

    const displayBlob = useMemo<FileBlob | null>(() => {
        if (!blob) return null;
        if (blob.encoding !== 'utf-8') return blob;
        return { ...blob, content: isOversized ? textPreview!.content : editedContent };
    }, [blob, textPreview, isOversized, editedContent]);

    return {
        blob,
        displayBlob,
        isOversized: Boolean(isOversized),
        loading,
        error,
        status: loading ? 'loading' : error ? 'error' : 'ready',
        retry: load,
        reload,
        reloading,
        editedContent,
        isDirty,
        isSaving,
        onChange,
        save,
        discard,
    };
}
