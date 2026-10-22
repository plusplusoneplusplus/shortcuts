/**
 * An owned `DiffEditorAdapter` for tests. It records calls and lets the test
 * decide when a diff "finishes computing"; it does not imitate Monaco's
 * rendering or diff algorithm — line changes are supplied by the test.
 */

import { vi } from 'vitest';
import type {
    CommentDecoration,
    DiffEditorAdapter,
    DiffLanguageMount,
    DiffLanguageMountContext,
    DiffEditorSelection,
    DiffEditorSelectionAction,
    GlyphWidgetSpec,
    ViewZoneSpec,
} from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffController';
import type { DiffLineChange } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import type { DiffEditorOptions, DiffModelsInput } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';

export interface FakeDiffEditor {
    adapter: DiffEditorAdapter;
    /** Models passed to setModels, in order. */
    models: DiffModelsInput[];
    options: DiffEditorOptions[];
    listeners: Set<() => void>;
    listenerDisposals: number;
    disposals: number;
    /** Live view zones by id (removed on removeViewZone and setModels, like Monaco). */
    zones: Map<string, ViewZoneSpec>;
    /** Every zone ever added, in order (to detect duplicates). */
    zoneLog: { op: 'add' | 'remove' | 'layout'; id: string; side: string; heightInPx?: number }[];
    decorations: readonly CommentDecoration[];
    glyph: GlyphWidgetSpec | null;
    actions: DiffEditorSelectionAction[];
    revealedLines: { side: string; line: number }[];
    /** Language mounts made on the modified model, in order; `live` until cleaned up. */
    languageMounts: { uri: string; live: boolean }[];
    /** Historical (ref-backed) mounts per side, in order; `live` until cleaned up. */
    historicalMounts: { side: 'original' | 'modified'; uri: string; live: boolean }[];
    /** Language-marker lists published per document URI, in order. */
    markerLog: { uri: string; count: number }[];
    /**
     * The structural Monaco context handed to a language mount. Tests that
     * exercise real provider wiring replace it; the default is inert.
     */
    languageContext: () => DiffLanguageMountContext;
    /** Emit a selection change (null = collapsed). */
    select(selection: DiffEditorSelection | null): void;
    /** Run a registered context-menu action on a selection. */
    runAction(id: string, selection: DiffEditorSelection): void;
    /** Make the current diff available and fire onDidUpdateDiff. */
    finishDiff(changes: DiffLineChange[]): void;
    /** Fire onDidUpdateDiff without changing the result. */
    fireDiff(): void;
    /** Text the modified model holds now (set by setModels and `type`). */
    modifiedText: string | null;
    /** Replace the modified text as a user edit would, firing content listeners. */
    type(text: string): void;
    /** Press Ctrl/Cmd+S: runs every bound save command. */
    pressSave(): void;
    /** Live save commands bound through addSaveCommand. */
    saveCommands: Set<() => void>;
}

export function createFakeDiffEditor(initialOptions?: DiffEditorOptions): FakeDiffEditor {
    let lineChanges: DiffLineChange[] | null = null;
    let nextZone = 1;
    const selectionListeners = new Set<(selection: DiffEditorSelection | null) => void>();
    let languageCleanup: (() => void) | null = null;
    const unmountLanguage = () => {
        const cleanup = languageCleanup;
        languageCleanup = null;
        cleanup?.();
    };
    const historicalCleanup: Record<'original' | 'modified', (() => void) | null> = { original: null, modified: null };
    const unmountHistorical = () => {
        for (const side of ['original', 'modified'] as const) {
            const cleanup = historicalCleanup[side];
            historicalCleanup[side] = null;
            cleanup?.();
        }
    };
    const contentListeners = new Set<(text: string) => void>();
    const currentModifiedUri = () => fake.models[fake.models.length - 1]?.modified.uri ?? null;
    const fake: FakeDiffEditor = {
        zones: new Map(),
        zoneLog: [],
        decorations: [],
        glyph: null,
        actions: [],
        revealedLines: [],
        languageMounts: [],
        historicalMounts: [],
        markerLog: [],
        languageContext: () => inertLanguageContext(currentModifiedUri() ?? ''),
        select(selection) {
            for (const listener of [...selectionListeners]) listener(selection);
        },
        runAction(id, selection) {
            const action = fake.actions.find(a => a.id === id);
            if (!action) throw new Error(`no action ${id}`);
            action.run(selection);
        },
        models: [],
        options: initialOptions ? [initialOptions] : [],
        listeners: new Set(),
        listenerDisposals: 0,
        disposals: 0,
        finishDiff(changes) {
            lineChanges = changes;
            fake.fireDiff();
        },
        fireDiff() {
            for (const listener of [...fake.listeners]) listener();
        },
        modifiedText: null,
        type(text) {
            fake.modifiedText = text;
            for (const listener of [...contentListeners]) listener(text);
        },
        saveCommands: new Set(),
        pressSave() {
            for (const run of [...fake.saveCommands]) run();
        },
        adapter: {
            setModels: vi.fn((models: DiffModelsInput) => {
                // Like the real adapter: providers go before their model does.
                unmountLanguage();
                unmountHistorical();
                fake.models.push(models);
                fake.modifiedText = models?.modified?.text ?? null;
                lineChanges = null; // a new pair starts computing
                // Monaco drops view zones, glyph widgets and decorations with the old models.
                fake.zones.clear();
                fake.glyph = null;
                fake.decorations = [];
            }),
            updateOptions: vi.fn((options: DiffEditorOptions) => { fake.options.push(options); }),
            setTheme: vi.fn(),
            layout: vi.fn(),
            getLineChanges: vi.fn(() => lineChanges),
            onDidUpdateDiff: vi.fn((listener: () => void) => {
                fake.listeners.add(listener);
                return {
                    dispose: () => {
                        fake.listenerDisposals++;
                        fake.listeners.delete(listener);
                    },
                };
            }),
            revealModifiedLine: vi.fn(),
            setCommentDecorations: vi.fn((decorations: readonly CommentDecoration[]) => { fake.decorations = decorations; }),
            addViewZone: vi.fn((zone: ViewZoneSpec) => {
                const id = `zone-${nextZone++}`;
                fake.zones.set(id, zone);
                fake.zoneLog.push({ op: 'add', id, side: zone.side, heightInPx: zone.heightInPx });
                return id;
            }),
            layoutViewZone: vi.fn((side: string, id: string, heightInPx: number) => {
                const zone = fake.zones.get(id);
                if (zone) zone.heightInPx = heightInPx;
                fake.zoneLog.push({ op: 'layout', id, side, heightInPx });
            }),
            removeViewZone: vi.fn((side: string, id: string) => {
                fake.zones.delete(id);
                fake.zoneLog.push({ op: 'remove', id, side });
            }),
            setGlyphWidget: vi.fn((glyph: GlyphWidgetSpec | null) => { fake.glyph = glyph; }),
            onDidChangeSelection: vi.fn((listener: (selection: DiffEditorSelection | null) => void) => {
                selectionListeners.add(listener);
                return { dispose: () => { selectionListeners.delete(listener); } };
            }),
            addSelectionActions: vi.fn((actions: readonly DiffEditorSelectionAction[]) => {
                fake.actions.push(...actions);
                return { dispose: () => { fake.actions = fake.actions.filter(a => !actions.includes(a)); } };
            }),
            getClientPosition: vi.fn((_side: string, line: number, column: number) => ({ top: line * 20, left: column * 7 })),
            revealLine: vi.fn((side: string, line: number) => { fake.revealedLines.push({ side, line }); }),
            attachModifiedLanguage: vi.fn((uri: string, mount: DiffLanguageMount) => {
                unmountLanguage();
                if (currentModifiedUri() !== uri) return null;
                const record = { uri, live: true };
                fake.languageMounts.push(record);
                const cleanup = mount(fake.languageContext());
                const done = () => { record.live = false; cleanup?.(); };
                languageCleanup = done;
                return { dispose: () => { if (languageCleanup === done) unmountLanguage(); } };
            }),
            attachHistoricalLanguage: vi.fn((side: 'original' | 'modified', mount: DiffLanguageMount) => {
                historicalCleanup[side]?.();
                historicalCleanup[side] = null;
                const uri = fake.models[fake.models.length - 1]?.[side].uri ?? null;
                if (!uri || !uri.startsWith('coc-diff-ref://')) return null;
                const record = { side, uri, live: true };
                fake.historicalMounts.push(record);
                const cleanup = mount(inertLanguageContext(uri));
                const done = () => { record.live = false; cleanup?.(); };
                historicalCleanup[side] = done;
                return { dispose: () => { if (historicalCleanup[side] === done) { historicalCleanup[side] = null; done(); } } };
            }),
            setModifiedMarkers: vi.fn((uri: string, markers: readonly unknown[]) => {
                if (currentModifiedUri() !== uri) return;
                fake.markerLog.push({ uri, count: markers.length });
            }),
            getModifiedValue: vi.fn(() => fake.modifiedText),
            onDidChangeModifiedContent: vi.fn((listener: (text: string) => void) => {
                contentListeners.add(listener);
                return { dispose: () => { contentListeners.delete(listener); } };
            }),
            addSaveCommand: vi.fn((run: () => void) => {
                fake.saveCommands.add(run);
                return { dispose: () => { fake.saveCommands.delete(run); } };
            }),
            dispose: vi.fn(() => { unmountLanguage(); unmountHistorical(); fake.disposals++; }),
        },
    };
    return fake;
}

/** A promise with its resolver exposed, to control adapter arrival. */
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

export const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** A context whose Monaco pieces accept every call and do nothing. */
export function inertLanguageContext(uri: string): DiffLanguageMountContext {
    const disposable = { dispose: () => {} };
    const listen = () => disposable;
    const editor = {
        createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
        onDidChangeModelContent: listen,
        onDidScrollChange: listen,
        onKeyDown: listen,
        onKeyUp: listen,
        onMouseLeave: listen,
        onMouseMove: listen,
    };
    const monaco = {
        Uri: { parse: (value: string) => ({ toString: () => value }) },
        languages: {
            registerHoverProvider: () => disposable,
            registerDefinitionProvider: () => disposable,
            registerReferenceProvider: () => disposable,
            registerCompletionItemProvider: () => disposable,
            registerSignatureHelpProvider: () => disposable,
        },
        editor: { getModel: () => null },
    };
    const model = {
        uri: { toString: () => uri },
        getLanguageId: () => 'plaintext',
        getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
        getWordAtPosition: () => null,
        getValueLength: () => 0,
    };
    return { editor, monaco, model } as unknown as DiffLanguageMountContext;
}

/** Side-local selection editors for selection action portal tests. */
export function createFakeSelectionEditors(fake: FakeDiffEditor) {
    const sides = Object.fromEntries(['original', 'modified'].map(side => {
        const host = document.createElement('div');
        const buffer = document.createElement('textarea');
        host.append(buffer);
        const events: Record<string, () => void> = {};
        const disposals: ReturnType<typeof vi.fn>[] = [];
        const data = { empty: true, focused: false, snippet: side === 'original' ? 'old' : 'unsaved', top: 40, left: 90, width: 400 };
        const listen = (name: string, cb: () => void) => { events[name] = cb; const dispose = vi.fn(); disposals.push(dispose); return { dispose }; };
        const selection = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4,
            isEmpty: () => data.empty, getEndPosition: () => ({ lineNumber: selection.endLineNumber, column: selection.endColumn }) };
        const editor = {
            getDomNode: () => host, getSelection: () => selection,
            getModel: () => ({ getValueInRange: () => data.snippet }), hasWidgetFocus: () => data.focused,
            hasTextFocus: () => document.activeElement === buffer,
            getScrolledVisiblePosition: () => ({ top: data.top, left: data.left, height: 20 }),
            getLayoutInfo: () => ({ width: data.width, height: 300, contentLeft: 40, contentWidth: 350 }),
            onDidChangeCursorSelection: (cb: () => void) => listen('selection', cb),
            onDidScrollChange: (cb: () => void) => listen('scroll', cb),
            onDidLayoutChange: (cb: () => void) => listen('layout', cb),
            onDidChangeModel: (cb: () => void) => listen('model', cb),
            onDidBlurEditorWidget: (cb: () => void) => listen('blur', cb),
            onDidFocusEditorWidget: (cb: () => void) => listen('focus', cb),
        };
        return [side, { host, buffer, events, data, selection, editor, disposals }];
    }));
    fake.adapter.getSelectionEditor = side => sides[side].editor as any;
    return sides;
}
