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

import type * as MonacoApi from 'monaco-editor';
import type { DiffEditorSide, DiffLineChange } from './diffCoords';
import type { MonacoRange } from '../../language-servers/monacoBridge';
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

/** How a commented range is drawn: open, resolved (muted) or recovered by fingerprint. */
export type CommentDecorationKind = 'open' | 'resolved' | 'recovered';

export interface CommentDecoration {
    side: DiffEditorSide;
    range: MonacoRange;
    kind: CommentDecorationKind;
}

/** An inline view zone hosting a comment thread below `afterLineNumber`. */
export interface ViewZoneSpec {
    side: DiffEditorSide;
    afterLineNumber: number;
    heightInPx: number;
    domNode: HTMLElement;
}

/** A non-empty text selection in one of the two editors. */
export interface DiffEditorSelection {
    side: DiffEditorSide;
    range: MonacoRange;
}

/** An editor context-menu entry that acts on the current selection. */
export interface DiffEditorSelectionAction {
    id: string;
    label: string;
    run(selection: DiffEditorSelection): void;
}

/** The interactive add-comment glyph shown beside a selection. */
export interface GlyphWidgetSpec {
    side: DiffEditorSide;
    line: number;
    domNode: HTMLElement;
}

/**
 * The modified editor and its model, handed to a language host (AC-06). Monaco
 * values, typed only: this module never touches them.
 */
export interface DiffLanguageMountContext {
    editor: MonacoApi.editor.ICodeEditor;
    monaco: typeof MonacoApi;
    model: MonacoApi.editor.ITextModel;
}

/** Registers language features on the modified model; returns its cleanup. */
export type DiffLanguageMount = (context: DiffLanguageMountContext) => (() => void) | void;

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
    /** Replace every comment-range decoration on both sides. */
    setCommentDecorations(decorations: readonly CommentDecoration[]): void;
    /** Add a view zone; returns its id. Zones vanish on `setModels`. */
    addViewZone(zone: ViewZoneSpec): string;
    /** Re-measure a zone after its content changed height. */
    layoutViewZone(side: DiffEditorSide, id: string, heightInPx: number): void;
    removeViewZone(side: DiffEditorSide, id: string): void;
    /** Show (or, with null, remove) the add-comment glyph widget. */
    setGlyphWidget(widget: GlyphWidgetSpec | null): void;
    /** Side editor for React selection overlays; optional for non-Monaco adapters. */
    getSelectionEditor?(side: DiffEditorSide): MonacoApi.editor.ICodeEditor;
    /** Fires with the selection on either side; null when it collapses. */
    onDidChangeSelection(listener: (selection: DiffEditorSelection | null) => void): Disposable;
    /** Adds selection actions to both editors' context menus. */
    addSelectionActions(actions: readonly DiffEditorSelectionAction[]): Disposable;
    /** Viewport position of a line/column, or null when it is off-screen. */
    getClientPosition(side: DiffEditorSide, line: number, column: number): { top: number; left: number } | null;
    /** Scroll `side` so `line` is centred. */
    revealLine(side: DiffEditorSide, line: number): void;
    /**
     * Mount language features on the modified model, but only when that model
     * is exactly `documentUri` (the real working-copy document). Returns null
     * and mounts nothing for any other model: a synthetic ref side, a conflict
     * variant, or no model. The mount is undone before the next model swap and
     * on dispose, whichever comes first.
     */
    attachModifiedLanguage(documentUri: string, mount: DiffLanguageMount): Disposable | null;
    /**
     * Publish language diagnostics on the modified model; `[]` clears them.
     * Ignored unless that model is exactly `documentUri`.
     */
    setModifiedMarkers(documentUri: string, markers: readonly MonacoApi.editor.IMarkerData[]): void;
    /** Current text of the modified model (user edits included); null with no model. */
    getModifiedValue(): string | null;
    /** Fires with the modified model's full text after each edit to it. */
    onDidChangeModifiedContent(listener: (text: string) => void): Disposable;
    /** Binds Ctrl/Cmd+S in the modified editor to `run`. */
    addSaveCommand(run: () => void): Disposable;
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
    /**
     * Fired after a new model pair reaches the editor. View zones, glyph
     * widgets and decorations belong to the editor, not the models, and were
     * cleared by the swap: re-add them here.
     */
    onModelsApplied?(models: DiffModelsInput): void;
}

export interface MonacoDiffController {
    setModels(models: DiffModelsInput): void;
    setOptions(options: DiffEditorOptions): void;
    setTheme(theme: DiffEditorTheme): void;
    layout(size: EditorSize): void;
    navigate(intent: HunkIntent): void;
    isAttached(): boolean;
    /** The attached editor, for comment overlays; null before attach and after dispose. */
    getEditor(): DiffEditorAdapter | null;
    isHunkNavigationReady(): boolean;
    getHunkCount(): number;
    getCurrentHunkIndex(): number;
    getHunks(): readonly DiffHunk[];
    dispose(): void;
    isDisposed(): boolean;
}

/** `models` with the modified text the editor holds now, so edits reach diff consumers. */
function withLiveModifiedText(adapter: DiffEditorAdapter, models: DiffModelsInput): DiffModelsInput {
    const text = adapter.getModifiedValue();
    if (text === null || text === models.modified.text) return models;
    return { ...models, modified: { ...models.modified, text } };
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
        callbacks.onModelsApplied?.(models);
        // Monaco may already hold a result (e.g. identical models); otherwise
        // this is null and readiness waits for `onDidUpdateDiff`.
        readDiff();
    };

    const readDiff = () => {
        if (disposed || !adapter || !appliedModels) return;
        const changes = adapter.getLineChanges();
        navigator.setLineChanges(changes);
        if (changes) callbacks.onLineChanges?.(changes, withLiveModifiedText(adapter, appliedModels));
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
        getEditor: () => (disposed ? null : adapter),
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
