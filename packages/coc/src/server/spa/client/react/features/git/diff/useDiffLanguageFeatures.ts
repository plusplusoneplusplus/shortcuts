/**
 * useDiffLanguageFeatures — the language document behind the modified side of
 * an unstaged diff or server-confirmed clean branch-range head.
 *
 * It joins the explorer's shared buffer through `useLanguageDocument` (one
 * document per path per workspace, ref-counted), so a file open in both the
 * explorer and the diff is one document to the server, and closing the diff
 * only drops the diff's reference.
 *
 * Features are offered only while they can be right:
 *   - the target must pass `resolveDiffLanguageTarget` (working copy, real URI,
 *     within the explorer's size limit) — nothing else opens a document;
 *   - the shared buffer must hold exactly the text the diff shows. An unsaved
 *     explorer edit makes the buffer diverge from disk, and its positions and
 *     diagnostics would land on the wrong lines of the diff;
 *   - the host must not have refused the document (no server, capacity).
 * Otherwise the result is null and the diff is a plain read-only diff.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LanguageDocumentStore } from '../../language-servers/documentStore';
import { useLanguageDocument } from '../../language-servers/useLanguageDocument';
import type { DiffLanguageMount } from './monacoDiffController';
import type { DiffModelsInput, MonacoDiffStage } from './monacoDiffOptions';
import { resolveDiffLanguageTarget } from './diffLanguageEligibility';
import { mountDiffLanguageModel, type DiffDefinitionNavigate } from './diffLanguageMount';

export interface DiffLanguageFeatures {
    /** The working-copy document URI; the adapter mounts only on this model. */
    uri: string;
    /** Stable while the document stays the same. */
    mount: DiffLanguageMount;
    markers: readonly monacoEditor.IMarkerData[];
}

export interface UseDiffLanguageFeaturesOptions {
    workspaceId: string;
    relativePath: string;
    stage: MonacoDiffStage;
    models: DiffModelsInput;
    /** False turns the feature off entirely: no document is opened. */
    enabled?: boolean;
    /** Injected in tests; defaults to the per-workspace store. */
    store?: LanguageDocumentStore;
    onNavigate?: DiffDefinitionNavigate;
}

export function useDiffLanguageFeatures(options: UseDiffLanguageFeaturesOptions): DiffLanguageFeatures | null {
    const { workspaceId, relativePath, stage, models, enabled = true, store, onNavigate } = options;
    const target = resolveDiffLanguageTarget({ workspaceId, relativePath, stage, models });
    const text = models.modified.text;
    const language = models.modified.language;

    const document = useLanguageDocument({
        workspaceId,
        path: target.eligible ? target.path : null,
        enabled: enabled && target.eligible,
        text,
        fallbackLanguageId: language,
        store,
    });
    const { view } = document;

    // `update` (an explorer keystroke) fires onText, not onStatus.
    const [bufferText, setBufferText] = useState<string | null>(null);
    useEffect(() => {
        if (!view) {
            setBufferText(null);
            return;
        }
        setBufferText(view.getText());
        return view.onText(next => setBufferText(next));
    }, [view]);

    const inSync = view !== null && bufferText === text && view.getText() === text;
    const refused = document.status === 'unavailable';
    const live = inSync && !refused && target.eligible;

    // Read through a ref so a host that rebuilds its callback every render
    // does not tear the providers down with it.
    const navigateRef = useRef(onNavigate);
    navigateRef.current = onNavigate;
    const mount = useCallback<DiffLanguageMount>(
        context => (view
            ? mountDiffLanguageModel({
                ...context,
                view,
                workspaceId,
                languageId: language,
                onNavigate: target => navigateRef.current?.(target) ?? false,
            })
            : undefined),
        [view, workspaceId, language],
    );

    const uri = target.eligible ? target.uri : null;
    const { markers } = document;
    return useMemo(
        () => (live && uri ? { uri, mount, markers } : null),
        [live, uri, mount, markers],
    );
}
