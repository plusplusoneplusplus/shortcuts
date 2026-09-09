/**
 * `useLanguageDocument` — the React seam between a file-viewer host and the
 * authoritative buffer in `documentStore.ts` (AC-02).
 *
 * A host calls this with the identity of a *live repo document* and gets back
 * the handle it needs to drive Monaco: the shared view, the current status, and
 * the diagnostics as Monaco markers. Everything else stays where it already is
 * — loading, saving, read-only rules and tab chrome all belong to the host.
 *
 * Two rules shape the hook, and both exist because a document outlives the
 * component that shows it:
 *
 *   - Language support is opt-in. A host that passes `enabled: false`, or no
 *     path, gets an inert result and the store is never touched. That is what
 *     keeps diffs, search buffers, generated snippets and truncated previews
 *     from being mistaken for live repo files.
 *   - The `text` prop is *disk* text, not the buffer. It seeds the document on
 *     open and is offered to `setDiskText` on later reads, which the store
 *     refuses while the buffer is dirty. The buffer, not the prop, is the truth
 *     once the user has typed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import {
    getLanguageDocumentStore,
    type DocumentContentChange,
    type LanguageDocumentSnapshot,
    type LanguageDocumentStatus,
    type LanguageDocumentStore,
    type LanguageDocumentView,
    type LspDiagnostic,
} from './documentStore';
import { toMarkers } from './monacoBridge';

export interface UseLanguageDocumentOptions {
    /** Owning workspace. Empty or missing disables the hook. */
    workspaceId?: string | null;
    /** Repo-relative path. Empty or missing disables the hook. */
    path?: string | null;
    /**
     * The host's opt-in. False for anything that is not a live repo document:
     * previews of truncated content, diffs, search buffers, canvas snippets.
     */
    enabled?: boolean;
    /** Latest text read from disk. Seeds the document; never overwrites dirt. */
    text: string;
    /** Monaco language id, used only when the host has no LSP language id. */
    fallbackLanguageId?: string;
    /** Injected in tests; defaults to the cached per-workspace store. */
    store?: LanguageDocumentStore;
}

export interface UseLanguageDocumentResult {
    /** Null whenever language support is off for this host or this file. */
    view: LanguageDocumentView | null;
    status: LanguageDocumentStatus;
    snapshot: LanguageDocumentSnapshot | null;
    diagnostics: LspDiagnostic[];
    /** `diagnostics` converted for `monaco.editor.setModelMarkers`. */
    markers: monacoEditor.IMarkerData[];
    /** True when the buffer is synchronized and requests are meaningful. */
    ready: boolean;
    /** Feed Monaco's change event here; a no-op when support is off. */
    handleChange: (text: string, changes?: DocumentContentChange[]) => void;
    /** Call after the disk write succeeded — never before. */
    markSaved: (text?: string) => void;
}

const NO_DIAGNOSTICS: LspDiagnostic[] = [];
const NO_MARKERS: monacoEditor.IMarkerData[] = [];

export function useLanguageDocument(options: UseLanguageDocumentOptions): UseLanguageDocumentResult {
    const { workspaceId, path, enabled = true, text, fallbackLanguageId, store: injectedStore } = options;
    const active = enabled && !!workspaceId && !!path;

    const [view, setView] = useState<LanguageDocumentView | null>(null);
    const [snapshot, setSnapshot] = useState<LanguageDocumentSnapshot | null>(null);
    const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>(NO_DIAGNOSTICS);

    // The opening text must not be a dependency of the open effect: it changes
    // on every keystroke the host echoes back, and reopening the document per
    // keystroke would close and replay it against the server each time.
    const textRef = useRef(text);
    textRef.current = text;
    const fallbackRef = useRef(fallbackLanguageId);
    fallbackRef.current = fallbackLanguageId;

    useEffect(() => {
        if (!active) {
            setView(null);
            setSnapshot(null);
            setDiagnostics(NO_DIAGNOSTICS);
            return;
        }
        const store = injectedStore ?? getLanguageDocumentStore(workspaceId as string);
        const opened = store.open({
            path: path as string,
            text: textRef.current,
            fallbackLanguageId: fallbackRef.current,
        });
        setView(opened);
        setSnapshot(opened.getSnapshot());
        setDiagnostics(opened.getDiagnostics());
        const unsubscribeStatus = opened.onStatus(setSnapshot);
        const unsubscribeDiagnostics = opened.onDiagnostics((next) => {
            setDiagnostics(next.length === 0 ? NO_DIAGNOSTICS : next);
        });
        return () => {
            unsubscribeStatus();
            unsubscribeDiagnostics();
            opened.close();
            setView(null);
            setSnapshot(null);
            setDiagnostics(NO_DIAGNOSTICS);
        };
    }, [active, workspaceId, path, injectedStore]);

    // A later read from disk — a refresh, or a watcher — is offered to the
    // store, which refuses it while the buffer is dirty. Skipping the offer
    // when the text already matches keeps a re-render from touching the
    // version sequence.
    useEffect(() => {
        if (!view || view.getText() === text) {
            return;
        }
        view.setDiskText(text);
    }, [view, text]);

    const handleChange = useCallback((next: string, changes?: DocumentContentChange[]) => {
        view?.update(next, changes);
    }, [view]);

    const markSaved = useCallback((saved?: string) => {
        view?.markSaved(saved);
    }, [view]);

    const markers = useMemo(
        () => (diagnostics.length === 0 ? NO_MARKERS : toMarkers(diagnostics)),
        [diagnostics],
    );

    const status: LanguageDocumentStatus = snapshot?.status ?? 'detached';

    return {
        view,
        status,
        snapshot,
        diagnostics,
        markers,
        ready: status === 'ready',
        handleChange,
        markSaved,
    };
}
