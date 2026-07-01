import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
    MarkdownDocumentIO,
    MarkdownDocumentLoadResult,
    MarkdownDocumentSaveResult,
} from './MarkdownDocumentIO';

export type MarkdownDocumentSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface MarkdownDocumentSessionOptions {
    workspaceId: string;
    documentPath: string | null;
    io: MarkdownDocumentIO;
    root?: string;
    enabled?: boolean;
    autosaveDebounceMs?: number;
    resetSavedAfterMs?: number;
    loadRevision?: number;
    confirmBeforeLoadMessage?: string;
    confirmRefreshMessage?: string;
    onBeforeLoad?: () => void;
    onLoaded?: (result: MarkdownDocumentLoadResult) => void;
    onLoadError?: (error: unknown) => boolean | void;
    onSaved?: (content: string, result: MarkdownDocumentSaveResult) => void;
    onSaveError?: (error: unknown, content: string) => void;
    onConflict?: (error: unknown, content: string) => void;
    onDiscardDirty?: () => void;
    flushBeforeLoad?: boolean;
}

export interface SaveMarkdownDocumentOptions {
    expectedMtime?: number | null;
    markClean?: boolean;
}

export interface MarkdownDocumentSession {
    content: string;
    setContent: (content: string) => void;
    loading: boolean;
    loadError: string | null;
    saveState: MarkdownDocumentSaveState;
    setSaveState: Dispatch<SetStateAction<MarkdownDocumentSaveState>>;
    dirty: boolean;
    setDirty: Dispatch<SetStateAction<boolean>>;
    conflictContent: string | null;
    setConflictContent: Dispatch<SetStateAction<string | null>>;
    hasLoaded: boolean;
    mtimeRef: MutableRefObject<number | null>;
    pendingContentRef: MutableRefObject<string | null>;
    queueSave: (content: string) => void;
    flushSave: (options?: SaveMarkdownDocumentOptions) => Promise<void>;
    saveNow: (content: string, options?: SaveMarkdownDocumentOptions) => Promise<MarkdownDocumentSaveResult>;
    discardPending: () => void;
    refresh: () => boolean;
}

interface PendingSaveContext {
    workspaceId: string;
    documentPath: string;
    root?: string;
    expectedMtime: number | null;
}

function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function extractConflictContent(error: unknown): string | null {
    if (error && typeof error === 'object' && 'currentContent' in error) {
        const currentContent = (error as { currentContent?: unknown }).currentContent;
        return typeof currentContent === 'string' ? currentContent : null;
    }
    return null;
}

function isConflictError(error: unknown): boolean {
    return !!error && typeof error === 'object' && (error as { status?: unknown }).status === 409;
}

export function useMarkdownDocumentSession(options: MarkdownDocumentSessionOptions): MarkdownDocumentSession {
    const {
        workspaceId,
        documentPath,
        io,
        root,
        enabled = true,
        autosaveDebounceMs,
        resetSavedAfterMs = 3000,
        loadRevision = 0,
        confirmBeforeLoadMessage,
        confirmRefreshMessage = 'You have unsaved changes. Discard and refresh?',
    } = options;

    const [content, setContentState] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<MarkdownDocumentSaveState>('idle');
    const [dirty, setDirtyState] = useState(false);
    const [conflictContent, setConflictContent] = useState<string | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);
    const [hasLoaded, setHasLoaded] = useState(false);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingContentRef = useRef<string | null>(null);
    const pendingSaveContextRef = useRef<PendingSaveContext | null>(null);
    const mtimeRef = useRef<number | null>(null);
    const dirtyRef = useRef(false);

    const workspaceIdRef = useRef(workspaceId);
    const documentPathRef = useRef(documentPath);
    const ioRef = useRef(io);
    const rootRef = useRef(root);
    const callbacksRef = useRef(options);

    workspaceIdRef.current = workspaceId;
    documentPathRef.current = documentPath;
    ioRef.current = io;
    rootRef.current = root;
    callbacksRef.current = options;
    dirtyRef.current = dirty;

    const clearSaveTimer = useCallback(() => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
    }, []);

    const clearSavedResetTimer = useCallback(() => {
        if (savedResetTimerRef.current) {
            clearTimeout(savedResetTimerRef.current);
            savedResetTimerRef.current = null;
        }
    }, []);

    const setDirty = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
        setDirtyState((previous) => {
            const next = typeof value === 'function'
                ? (value as (previous: boolean) => boolean)(previous)
                : value;
            dirtyRef.current = next;
            return next;
        });
    }, []);

    const setContent = useCallback((nextContent: string) => {
        setContentState(nextContent);
    }, []);

    const discardPending = useCallback(() => {
        clearSaveTimer();
        pendingContentRef.current = null;
        pendingSaveContextRef.current = null;
        setDirty(false);
        setConflictContent(null);
        setSaveState('idle');
    }, [clearSaveTimer, setDirty]);

    const saveWithContext = useCallback(async (
        markdown: string,
        saveOptions: SaveMarkdownDocumentOptions = {},
        context?: PendingSaveContext,
    ): Promise<MarkdownDocumentSaveResult> => {
        const path = context?.documentPath ?? documentPathRef.current;
        if (path === null) {
            throw new Error('No markdown document is selected');
        }

        clearSaveTimer();
        clearSavedResetTimer();
        setSaveState('saving');
        try {
            const expectedMtime = saveOptions.expectedMtime === null
                ? undefined
                : saveOptions.expectedMtime ?? context?.expectedMtime ?? mtimeRef.current ?? undefined;
            const saveWorkspaceId = context?.workspaceId ?? workspaceIdRef.current;
            const saveRoot = context?.root ?? rootRef.current;
            const rawResult = await ioRef.current.saveContent(
                saveWorkspaceId,
                path,
                markdown,
                expectedMtime,
                saveRoot,
            );
            const result = rawResult ?? {
                path,
                updated: true,
                mtime: mtimeRef.current ?? 0,
            };
            pendingContentRef.current = null;
            pendingSaveContextRef.current = null;
            const isCurrentDocument =
                saveWorkspaceId === workspaceIdRef.current &&
                path === documentPathRef.current &&
                saveRoot === rootRef.current;
            if (isCurrentDocument) {
                mtimeRef.current = result.mtime;
                setContentState(markdown);
            }
            setConflictContent(null);
            setSaveState('saved');
            if (isCurrentDocument && saveOptions.markClean !== false) setDirty(false);
            callbacksRef.current.onSaved?.(markdown, result);
            savedResetTimerRef.current = setTimeout(() => {
                setSaveState((state) => state === 'saved' ? 'idle' : state);
            }, resetSavedAfterMs);
            return result;
        } catch (error) {
            if (isConflictError(error)) {
                setConflictContent(extractConflictContent(error));
                setSaveState('conflict');
                pendingContentRef.current = markdown;
                pendingSaveContextRef.current = context ?? {
                    workspaceId: saveWorkspaceId,
                    documentPath: path,
                    root: saveRoot,
                    expectedMtime: mtimeRef.current,
                };
                callbacksRef.current.onConflict?.(error, markdown);
            } else {
                setSaveState('error');
                callbacksRef.current.onSaveError?.(error, markdown);
            }
            throw error;
        }
    }, [clearSaveTimer, clearSavedResetTimer, resetSavedAfterMs, setDirty]);

    const saveNow = useCallback(async (
        markdown: string,
        saveOptions: SaveMarkdownDocumentOptions = {},
    ): Promise<MarkdownDocumentSaveResult> => saveWithContext(markdown, saveOptions), [saveWithContext]);

    const flushSave = useCallback(async (saveOptions: SaveMarkdownDocumentOptions = {}) => {
        const pending = pendingContentRef.current;
        if (pending === null) return;
        try {
            await saveWithContext(pending, saveOptions, pendingSaveContextRef.current ?? undefined);
        } catch {
            // Autosave callers observe saveState/conflictContent; they should not
            // receive unhandled promise rejections for background failures.
        }
    }, [saveWithContext]);

    const queueSave = useCallback((nextContent: string) => {
        pendingContentRef.current = nextContent;
        const path = documentPathRef.current;
        pendingSaveContextRef.current = path !== null
            ? {
                workspaceId: workspaceIdRef.current,
                documentPath: path,
                root: rootRef.current,
                expectedMtime: mtimeRef.current,
            }
            : null;
        setDirty(true);
        if (autosaveDebounceMs === undefined) return;
        clearSaveTimer();
        saveTimerRef.current = setTimeout(() => {
            void flushSave();
        }, autosaveDebounceMs);
    }, [autosaveDebounceMs, clearSaveTimer, flushSave, setDirty]);

    const refresh = useCallback(() => {
        if (dirtyRef.current) {
            if (!window.confirm(confirmRefreshMessage)) return false;
            discardPending();
            callbacksRef.current.onDiscardDirty?.();
        }
        setRefreshCounter((counter) => counter + 1);
        return true;
    }, [confirmRefreshMessage, discardPending]);

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            setLoadError(null);
            setContentState('');
            setHasLoaded(false);
            discardPending();
            return;
        }

        if (dirtyRef.current && confirmBeforeLoadMessage) {
            if (!window.confirm(confirmBeforeLoadMessage)) return;
            discardPending();
            callbacksRef.current.onDiscardDirty?.();
        }

        if (callbacksRef.current.flushBeforeLoad) void flushSave();
        callbacksRef.current.onBeforeLoad?.();
        discardPending();
        setLoading(true);
        setLoadError(null);
        setSaveState('idle');
        setConflictContent(null);
        setHasLoaded(false);

        if (documentPath === null) {
            setContentState('');
            mtimeRef.current = null;
            setLoading(false);
            return;
        }

        let cancelled = false;
        io.loadContent(workspaceId, documentPath, root)
            .then((result) => {
                if (cancelled) return;
                mtimeRef.current = result.mtime;
                setContentState(result.content);
                setDirty(false);
                setHasLoaded(true);
                callbacksRef.current.onLoaded?.(result);
            })
            .catch((error) => {
                if (cancelled) return;
                const handled = callbacksRef.current.onLoadError?.(error);
                if (!handled) setLoadError(errorMessage(error, 'Failed to load markdown document'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        discardPending,
        documentPath,
        enabled,
        loadRevision,
        refreshCounter,
        workspaceId,
        root,
        io,
        confirmBeforeLoadMessage,
        flushSave,
    ]);

    useEffect(() => {
        if (!dirty) return;
        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    useEffect(() => {
        return () => {
            clearSaveTimer();
            clearSavedResetTimer();
        };
    }, [clearSaveTimer, clearSavedResetTimer]);

    return {
        content,
        setContent,
        loading,
        loadError,
        saveState,
        setSaveState,
        dirty,
        setDirty,
        conflictContent,
        setConflictContent,
        hasLoaded,
        mtimeRef,
        pendingContentRef,
        queueSave,
        flushSave,
        saveNow,
        discardPending,
        refresh,
    };
}

export function useMarkdownDocumentKeyboardShortcuts(options: {
    onSave?: () => void | Promise<void>;
    saveEnabled?: boolean;
    onRefresh?: () => void;
    refreshEnabled?: boolean;
    onKeyDown?: (event: KeyboardEvent) => void;
}) {
    const optionsRef = useRef(options);
    optionsRef.current = options;

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const current = optionsRef.current;
            if ((event.ctrlKey || event.metaKey) && event.key === 's' && current.saveEnabled !== false && current.onSave) {
                event.preventDefault();
                void current.onSave();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'R' && current.refreshEnabled !== false && current.onRefresh) {
                event.preventDefault();
                current.onRefresh();
                return;
            }
            current.onKeyDown?.(event);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);
}
