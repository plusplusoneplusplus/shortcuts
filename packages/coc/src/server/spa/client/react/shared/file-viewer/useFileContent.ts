/**
 * useFileContent — the fetch/edit state machine a file viewer needs: abort and
 * refetch on `key` change, loading/error/retry, the 512 KB oversize cut, and
 * the edit buffer. Transport is injected, so no endpoint leaks in here. Host
 * callback plumbing (`onDirtyChange`/`onStatusChange`/`onRegisterSave`) stays
 * with the host as thin effects over the values returned here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileBlob, FileViewerStatus } from './types';

/** Text past this is shown truncated and view-only. */
export const MAX_FILE_VIEW_SIZE = 512 * 1024; // 512 KB

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

export interface UseFileContent {
    /** The bytes as read, before truncation or edits. */
    blob: FileBlob | null;
    /** What to render: the edit buffer, or the 512 KB slice when oversized. */
    displayBlob: FileBlob | null;
    isOversized: boolean;
    loading: boolean;
    error: string | null;
    status: FileViewerStatus;
    retry: () => void;
    editedContent: string;
    isDirty: boolean;
    isSaving: boolean;
    /** Records an edit. No-op when the buffer has no `write`. */
    onChange: (value: string) => void;
    /** Resolves true only when the write succeeded. */
    save: () => Promise<boolean>;
}

export function useFileContent({ key, read, write, onError }: UseFileContentOptions): UseFileContent {
    const [blob, setBlob] = useState<FileBlob | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    // Refs so changing callback identities never re-trigger the fetch.
    const readRef = useRef(read);
    readRef.current = read;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const writeRef = useRef(write);
    writeRef.current = write;
    const canWrite = write !== undefined;

    const load = useCallback(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        setBlob(null);
        setIsDirty(false);
        setEditedContent('');

        // No target to read — stay in `loading` without touching the transport.
        if (key === null) {
            return controller;
        }

        readRef.current(controller.signal)
            .then((data) => {
                if (!controller.signal.aborted) {
                    setBlob(data);
                    if (data.encoding === 'utf-8') setEditedContent(data.content);
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
        setEditedContent(value);
        setIsDirty(true);
    }, [canWrite]);

    const save = useCallback(async (): Promise<boolean> => {
        const writeFn = writeRef.current;
        if (!writeFn) return false;
        setIsSaving(true);
        try {
            await writeFn(editedContent);
            setIsDirty(false);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [editedContent]);

    const isOversized = blob?.encoding === 'utf-8' && blob.content.length > MAX_FILE_VIEW_SIZE;
    const displayBlob = useMemo<FileBlob | null>(() => {
        if (!blob) return null;
        if (blob.encoding !== 'utf-8') return blob;
        return { ...blob, content: isOversized ? blob.content.slice(0, MAX_FILE_VIEW_SIZE) : editedContent };
    }, [blob, isOversized, editedContent]);

    return {
        blob,
        displayBlob,
        isOversized: Boolean(isOversized),
        loading,
        error,
        status: loading ? 'loading' : error ? 'error' : 'ready',
        retry: load,
        editedContent,
        isDirty,
        isSaving,
        onChange,
        save,
    };
}
