/**
 * monacoDiffEditorAdapter — the one place `DiffEditorAdapter` meets Monaco.
 *
 * Deliberately thin: each method is a direct Monaco call. Ordering, readiness,
 * staleness and disposal policy live in `monacoDiffController.ts`; model
 * sharing lives in `monacoDiffModelRegistry.ts`. The `monaco` namespace is
 * passed in (from `@monaco-editor/react`'s loader, configured with the local
 * bundle in `monaco-setup.ts`), so this module has no Monaco value import.
 */

import { loader } from '@monaco-editor/react';
import type * as MonacoApi from 'monaco-editor';
import type { DiffEditorAdapter, Disposable, CommentDecorationKind } from './monacoDiffController';
import { LANGUAGE_MARKER_OWNER } from '../../language-servers/monacoBridge';
import type { DiffEditorSide } from './diffCoords';
import type { MonacoRange } from '../../language-servers/monacoBridge';
import type { DiffEditorOptions } from './monacoDiffOptions';
import { createModelRegistry, type ModelLease, type ModelRegistry } from './monacoDiffModelRegistry';

type Monaco = typeof MonacoApi;
type TextModel = MonacoApi.editor.ITextModel;
type CodeEditor = MonacoApi.editor.ICodeEditor;

const ADD_COMMENT_GLYPH_ID = 'coc.diff.addComment';
const SAVE_ACTION_ID = 'coc.diff.save';
const SIDES: readonly DiffEditorSide[] = ['original', 'modified'];

function plainRange(range: MonacoRange): MonacoRange {
    return {
        startLineNumber: range.startLineNumber,
        startColumn: range.startColumn,
        endLineNumber: range.endLineNumber,
        endColumn: range.endColumn,
    };
}

function commentDecorationOptions(kind: CommentDecorationKind): MonacoApi.editor.IModelDecorationOptions {
    return {
        inlineClassName: `coc-diff-comment-range coc-diff-comment-${kind}`,
        linesDecorationsClassName: `coc-diff-comment-gutter coc-diff-comment-gutter-${kind}`,
        // NeverGrowsWhenTypingAtEdges
        stickiness: 1,
    };
}

// One registry per Monaco instance: models are global to it.
const registries = new WeakMap<Monaco, ModelRegistry<TextModel>>();

function registryFor(monaco: Monaco): ModelRegistry<TextModel> {
    let registry = registries.get(monaco);
    if (!registry) {
        registry = createModelRegistry<TextModel>({
            getModel: uri => monaco.editor.getModel(monaco.Uri.parse(uri)),
            createModel: (text, language, uri) => monaco.editor.createModel(text, language, monaco.Uri.parse(uri)),
        });
        registries.set(monaco, registry);
    }
    return registry;
}

export function createMonacoDiffEditorAdapter(
    monaco: Monaco,
    host: HTMLElement,
    options: DiffEditorOptions,
): DiffEditorAdapter {
    const editor = monaco.editor.createDiffEditor(host, options);
    const registry = registryFor(monaco);
    let leases: ModelLease<TextModel>[] = [];
    const sideEditor = (side: DiffEditorSide): CodeEditor =>
        side === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor();
    const decorations = {
        original: editor.getOriginalEditor().createDecorationsCollection(),
        modified: editor.getModifiedEditor().createDecorationsCollection(),
    };
    // Zone ids are per editor, so they are tracked per side.
    const zones = { original: new Map<string, MonacoApi.editor.IViewZone>(), modified: new Map<string, MonacoApi.editor.IViewZone>() };
    let glyph: { side: DiffEditorSide; widget: MonacoApi.editor.IGlyphMarginWidget } | null = null;

    const removeGlyph = () => {
        if (glyph) sideEditor(glyph.side).removeGlyphMarginWidget(glyph.widget);
        glyph = null;
    };

    // Overlays belong to the editor, not the models: drop them before a swap
    // so none outlives the file it was placed for.
    const clearOverlays = () => {
        for (const side of SIDES) {
            const ids = [...zones[side].keys()];
            if (ids.length) sideEditor(side).changeViewZones(acc => { for (const id of ids) acc.removeZone(id); });
            zones[side].clear();
            decorations[side].clear();
        }
        removeGlyph();
    };

    // The modified model, only when it is exactly the working-copy document.
    // Compared in Monaco's normalized form, so encoding differences cannot let
    // a synthetic or conflict-variant URI through.
    const documentModel = (documentUri: string): TextModel | null => {
        const model = editor.getModifiedEditor().getModel();
        return model && model.uri.toString() === monaco.Uri.parse(documentUri).toString() ? model : null;
    };

    // At most one language mount, always on the current modified model.
    let languageCleanup: (() => void) | null = null;
    const unmountLanguage = () => {
        const cleanup = languageCleanup;
        languageCleanup = null;
        cleanup?.();
    };

    const releaseLeases = () => {
        for (const lease of leases) lease.release();
        leases = [];
    };

    return {
        setModels(models) {
            // Detach and release the old pair first, so a refreshed file gets
            // its real URI back instead of a conflict variant. Language
            // providers go before their model can be disposed.
            unmountLanguage();
            clearOverlays();
            editor.setModel(null);
            releaseLeases();
            const original = registry.acquire(models.original.uri, models.original.text, models.original.language);
            const modified = registry.acquire(models.modified.uri, models.modified.text, models.modified.language);
            leases = [original, modified];
            editor.setModel({ original: original.model, modified: modified.model });
        },
        updateOptions(next) {
            editor.updateOptions(next);
        },
        setTheme(theme) {
            monaco.editor.setTheme(theme);
        },
        layout(size) {
            editor.layout(size);
        },
        getLineChanges() {
            return editor.getLineChanges();
        },
        onDidUpdateDiff(listener): Disposable {
            return editor.onDidUpdateDiff(listener);
        },
        revealModifiedLine(line) {
            const modified = editor.getModifiedEditor();
            modified.revealLineInCenter(line);
            modified.setPosition({ lineNumber: line, column: 1 });
        },
        setCommentDecorations(next) {
            for (const side of SIDES) {
                decorations[side].set(next
                    .filter(d => d.side === side)
                    .map(d => ({ range: plainRange(d.range), options: commentDecorationOptions(d.kind) })));
            }
        },
        addViewZone(spec) {
            const zone: MonacoApi.editor.IViewZone = {
                afterLineNumber: spec.afterLineNumber,
                heightInPx: spec.heightInPx,
                domNode: spec.domNode,
            };
            let id = '';
            sideEditor(spec.side).changeViewZones(acc => { id = acc.addZone(zone); });
            zones[spec.side].set(id, zone);
            return id;
        },
        layoutViewZone(side, id, heightInPx) {
            const zone = zones[side].get(id);
            if (!zone) return;
            zone.heightInPx = heightInPx;
            sideEditor(side).changeViewZones(acc => acc.layoutZone(id));
        },
        removeViewZone(side, id) {
            if (!zones[side].delete(id)) return;
            sideEditor(side).changeViewZones(acc => acc.removeZone(id));
        },
        setGlyphWidget(spec) {
            removeGlyph();
            if (!spec) return;
            const range = { startLineNumber: spec.line, startColumn: 1, endLineNumber: spec.line, endColumn: 1 };
            const widget: MonacoApi.editor.IGlyphMarginWidget = {
                getId: () => ADD_COMMENT_GLYPH_ID,
                getDomNode: () => spec.domNode,
                getPosition: () => ({ lane: monaco.editor.GlyphMarginLane.Right, zIndex: 10, range }),
            };
            sideEditor(spec.side).addGlyphMarginWidget(widget);
            glyph = { side: spec.side, widget };
        },
        onDidChangeSelection(listener): Disposable {
            const subscriptions = SIDES.map(side => sideEditor(side).onDidChangeCursorSelection(e => {
                listener(e.selection.isEmpty() ? null : { side, range: plainRange(e.selection) });
            }));
            return { dispose: () => { for (const s of subscriptions) s.dispose(); } };
        },
        addSelectionActions(actions): Disposable {
            const registered = SIDES.flatMap(side => actions.map(action => sideEditor(side).addAction({
                id: action.id,
                label: action.label,
                contextMenuGroupId: '9_coc_comments',
                precondition: 'editorHasSelection',
                run: (ed) => {
                    const selection = ed.getSelection();
                    if (selection && !selection.isEmpty()) action.run({ side, range: plainRange(selection) });
                },
            })));
            return { dispose: () => { for (const r of registered) r.dispose(); } };
        },
        getClientPosition(side, line, column) {
            const ed = sideEditor(side);
            const position = ed.getScrolledVisiblePosition({ lineNumber: line, column });
            const dom = ed.getDomNode();
            if (!position || !dom) return null;
            const rect = dom.getBoundingClientRect();
            return { top: rect.top + position.top + position.height, left: rect.left + position.left };
        },
        revealLine(side, line) {
            sideEditor(side).revealLineInCenter(line);
        },
        attachModifiedLanguage(documentUri, mount): Disposable | null {
            unmountLanguage();
            const modifiedEditor = editor.getModifiedEditor();
            const model = documentModel(documentUri);
            if (!model) return null;
            const cleanup = mount({ editor: modifiedEditor, monaco, model }) ?? (() => {});
            languageCleanup = cleanup;
            return {
                dispose: () => {
                    if (languageCleanup !== cleanup) return;
                    unmountLanguage();
                },
            };
        },
        setModifiedMarkers(documentUri, markers) {
            const model = documentModel(documentUri);
            if (model) monaco.editor.setModelMarkers(model, LANGUAGE_MARKER_OWNER, [...markers]);
        },
        getModifiedValue() {
            return editor.getModifiedEditor().getModel()?.getValue() ?? null;
        },
        onDidChangeModifiedContent(listener): Disposable {
            const modifiedEditor = editor.getModifiedEditor();
            return modifiedEditor.onDidChangeModelContent(() => {
                const model = modifiedEditor.getModel();
                if (model) listener(model.getValue());
            });
        },
        addSaveCommand(run): Disposable {
            return editor.getModifiedEditor().addAction({
                id: SAVE_ACTION_ID,
                label: 'Save File',
                keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
                run: () => run(),
            });
        },
        dispose() {
            unmountLanguage();
            clearOverlays();
            editor.setModel(null);
            editor.dispose();
            releaseLeases();
        },
    };
}

/** Creates a diff editor adapter in `host`; async because Monaco loads lazily. */
export type DiffEditorFactory = (host: HTMLElement, options: DiffEditorOptions) => Promise<DiffEditorAdapter>;

/** Production factory: the loader resolves to the bundled Monaco instance. */
export const createDefaultDiffEditor: DiffEditorFactory = async (host, options) => {
    const monaco = await loader.init();
    return createMonacoDiffEditorAdapter(monaco, host, options);
};
