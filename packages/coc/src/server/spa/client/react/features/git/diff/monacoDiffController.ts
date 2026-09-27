/**
 * monacoDiffController — lifecycle for one Monaco diff editor instance.
 *
 * The React component owns a host element; everything else — async editor
 * creation, model swaps, option/theme/layout pushes, diff readiness, hunk
 * navigation and disposal — lives here, against the narrow
 * `DiffEditorAdapter` interface. The real adapter
 * (`monacoDiffEditorAdapter.ts`) is a thin mapping onto Monaco's API; tests
 * drive the controller with an owned fake adapter.
 *
 * Guarantees:
 *   - an adapter that resolves after `dispose()` is disposed immediately;
 *   - the latest models/options/theme/size are applied when the adapter
 *     arrives, whatever order they were set in;
 *   - diff updates after a model swap or disposal never reach the navigator
 *     or `onLineChanges` for the wrong models;
 *   - the adapter and its diff listener are each disposed exactly once.
 */

import type { DiffLineChange } from './diffCoords';
import type { DiffEditorOptions, DiffEditorTheme, DiffModelsInput } from './monacoDiffOptions';
import { sameDiffModels } from './monacoDiffOptions';
import { createHunkNavigator, type DiffHunk, type HunkIntent, type HunkNavigator } from './monacoDiffHunks';

export interface Disposable {
    dispose(): void;
}

export interface EditorSize {
    width: number;
    height: number;
}

/** What the controller needs from a diff editor. Monaco-shaped, Monaco-free. */
export interface DiffEditorAdapter {
    /** Replace both models; previously owned models are disposed. */
    setModels(models: DiffModelsInput): void;
    updateOptions(options: DiffEditorOptions): void;
    setTheme(theme: DiffEditorTheme): void;
    layout(size: EditorSize): void;
    /** Null while the diff is computing. */
    getLineChanges(): DiffLineChange[] | null;
    onDidUpdateDiff(listener: () => void): Disposable;
    /** Scroll the modified editor so `line` is centred and put the cursor there. */
    revealModifiedLine(line: number): void;
    /** Dispose the editor and every model it owns. */
    dispose(): void;
}

export interface MonacoDiffControllerCallbacks {
    /** Fired when a diff for the current models is ready (and on recompute). */
    onLineChanges?(changes: readonly DiffLineChange[], models: DiffModelsInput): void;
    /** Fired once, when the editor exists and the latest state is applied. */
    onAttach?(): void;
    /** Fired when the adapter failed to be created. */
    onError?(error: unknown): void;
}

export interface MonacoDiffController {
    setModels(models: DiffModelsInput): void;
    setOptions(options: DiffEditorOptions): void;
    setTheme(theme: DiffEditorTheme): void;
    layout(size: EditorSize): void;
    navigate(intent: HunkIntent): void;
    isAttached(): boolean;
    isHunkNavigationReady(): boolean;
    getHunkCount(): number;
    getCurrentHunkIndex(): number;
    getHunks(): readonly DiffHunk[];
    dispose(): void;
    isDisposed(): boolean;
}

export function createMonacoDiffController(
    createAdapter: () => Promise<DiffEditorAdapter>,
    callbacks: MonacoDiffControllerCallbacks = {},
): MonacoDiffController {
    let adapter: DiffEditorAdapter | null = null;
    let diffListener: Disposable | null = null;
    let disposed = false;
    let models: DiffModelsInput | null = null;
    let appliedModels: DiffModelsInput | null = null;
    let options: DiffEditorOptions | null = null;
    let theme: DiffEditorTheme | null = null;
    let size: EditorSize | null = null;

    const navigator: HunkNavigator = createHunkNavigator((hunk) => {
        adapter?.revealModifiedLine(hunk.revealLine);
    });

    const applyModels = () => {
        if (!adapter || !models || sameDiffModels(models, appliedModels)) return;
        appliedModels = models;
        adapter.setModels(models);
        // Monaco may already hold a result (e.g. identical models); otherwise
        // this is null and readiness waits for `onDidUpdateDiff`.
        readDiff();
    };

    const readDiff = () => {
        if (disposed || !adapter || !appliedModels) return;
        const changes = adapter.getLineChanges();
        navigator.setLineChanges(changes);
        if (changes) callbacks.onLineChanges?.(changes, appliedModels);
    };

    const attach = (created: DiffEditorAdapter) => {
        if (disposed) {
            created.dispose();
            return;
        }
        adapter = created;
        diffListener = created.onDidUpdateDiff(readDiff);
        if (options) created.updateOptions(options);
        if (theme) created.setTheme(theme);
        if (size) created.layout(size);
        applyModels();
        callbacks.onAttach?.();
    };

    createAdapter().then(attach, (error: unknown) => {
        if (!disposed) callbacks.onError?.(error);
    });

    return {
        setModels(next) {
            if (disposed || sameDiffModels(next, models)) return;
            // Reset on set, not on apply: a hunk request made right after
            // setModels, before the editor exists, must survive the attach.
            navigator.reset();
            models = next;
            applyModels();
        },
        setOptions(next) {
            if (disposed) return;
            options = next;
            adapter?.updateOptions(next);
        },
        setTheme(next) {
            if (disposed) return;
            theme = next;
            adapter?.setTheme(next);
        },
        layout(next) {
            if (disposed) return;
            size = next;
            adapter?.layout(next);
        },
        navigate(intent) {
            if (disposed) return;
            navigator.request(intent);
        },
        isAttached: () => adapter !== null && !disposed,
        isHunkNavigationReady: () => navigator.isReady(),
        getHunkCount: () => navigator.count(),
        getCurrentHunkIndex: () => navigator.currentIndex(),
        getHunks: () => navigator.hunks(),
        dispose() {
            if (disposed) return;
            disposed = true;
            navigator.reset();
            diffListener?.dispose();
            diffListener = null;
            adapter?.dispose();
            adapter = null;
            appliedModels = null;
        },
        isDisposed: () => disposed,
    };
}
