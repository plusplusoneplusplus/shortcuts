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
    const currentModifiedUri = () => fake.models[fake.models.length - 1]?.modified.uri ?? null;
    const fake: FakeDiffEditor = {
        zones: new Map(),
        zoneLog: [],
        decorations: [],
        glyph: null,
        actions: [],
        revealedLines: [],
        languageMounts: [],
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
        adapter: {
            setModels: vi.fn((models: DiffModelsInput) => {
                // Like the real adapter: providers go before their model does.
                unmountLanguage();
                fake.models.push(models);
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
            setModifiedMarkers: vi.fn((uri: string, markers: readonly unknown[]) => {
                if (currentModifiedUri() !== uri) return;
                fake.markerLog.push({ uri, count: markers.length });
            }),
            dispose: vi.fn(() => { unmountLanguage(); fake.disposals++; }),
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
    };
    return { editor, monaco, model } as unknown as DiffLanguageMountContext;
}
