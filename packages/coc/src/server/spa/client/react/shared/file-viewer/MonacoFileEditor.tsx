/**
 * MonacoFileEditor — React wrapper around Monaco Editor for file editing.
 *
 * Provides syntax highlighting, theme syncing, and Ctrl+S save keybinding.
 * Also serves as a read-only viewer (`readOnly`, no `onChange`/`onSave`), with
 * optional line reveal and whole-line range highlighting.
 *
 * It also carries the three hooks a language-server host needs, and no more:
 * the raw Monaco change list alongside the new text, a marker list to publish,
 * and `onModelMount`, which hands the live editor, `monaco` namespace and text
 * model up to the host so it can register providers against exactly this model.
 * All three are deliberately expressed in Monaco's own vocabulary — this
 * module knows nothing about LSP, documents or workspaces, so the conversion
 * and the decision to enable language support stay with the host (AC-02/AC-03).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useTheme } from '../../layout/ThemeProvider';
// A constant, from a module with no runtime Monaco or React dependency: the
// marker owner has to be the same string here and in the layer that builds the
// markers, so it lives in exactly one place.
import { LANGUAGE_MARKER_OWNER } from '../../features/language-servers/monacoBridge';

export { LANGUAGE_MARKER_OWNER };

/** The `monaco` namespace `@monaco-editor/react` hands to `onMount`. */
export type MonacoNamespace = Parameters<OnMount>[1];

/** What a host is given when a model becomes available in this editor. */
export interface EditorModelMountContext {
    editor: monacoEditor.IStandaloneCodeEditor;
    monaco: MonacoNamespace;
    model: monacoEditor.ITextModel;
}

/** One-based inclusive line range to highlight (`end === start` for one line). */
export interface EditorHighlightRange {
    start: number;
    end: number;
}

export interface MonacoFileEditorProps {
    value: string;
    language: string | null;
    /**
     * Omitted by read-only viewers, which have nothing to do with edits.
     *
     * `changes` is Monaco's own change list for the event, in the order Monaco
     * produced it. Hosts that only mirror text ignore it.
     */
    onChange?: (value: string, changes: readonly monacoEditor.IModelContentChange[]) => void;
    onSave?: () => void;
    /**
     * Diagnostics to publish under `LANGUAGE_MARKER_OWNER`. `undefined` means
     * this host does not manage markers at all, and the editor leaves the
     * model's markers untouched — that is what keeps a viewer with no language
     * support from clearing anyone else's squiggles.
     */
    markers?: readonly monacoEditor.IMarkerData[];
    /**
     * Called once a text model exists, and again whenever Monaco replaces it.
     * The returned cleanup runs when that model goes away — when it is swapped,
     * when the callback changes, or on unmount. This is the seam a language
     * host uses to register providers for one model and dispose them with it;
     * the editor itself never learns what was registered.
     */
    onModelMount?: (context: EditorModelMountContext) => (() => void) | void;
    /** When true the editor is non-editable and the save keybinding is suppressed. */
    readOnly?: boolean;
    /**
     * One-based line to scroll into view and select once the editor is ready.
     * Applied on mount and whenever it changes, so opening a second search hit in
     * the same file jumps to the new line.
     */
    revealLine?: number;
    /**
     * One-based column within `revealLine` to put the cursor on. Ignored without
     * a reveal line; defaults to the start of the line, which is what a search
     * hit or a deep link wants. A language-server navigation supplies the
     * symbol's own column so the cursor lands on it.
     */
    revealColumn?: number;
    /**
     * One-based inclusive line range to highlight as whole lines, centring the
     * first line in the viewport. Applied on mount and whenever it changes, so
     * opening a second `file:line` reference into an already-open file moves the
     * highlight without a remount. Clearing it removes the decorations.
     */
    highlightRange?: EditorHighlightRange | null;
}

/** CSS class on the whole-line highlight decoration (styled in tailwind.css). */
export const EDITOR_HIGHLIGHT_CLASS = 'source-canvas-line-highlight';

/**
 * Build the whole-line decorations for `range`, or an empty list when there is
 * no range (which clears an existing decorations collection).
 */
export function buildHighlightDecorations(
    range: EditorHighlightRange | null | undefined,
): monacoEditor.IModelDeltaDecoration[] {
    if (!range) return [];
    const { start, end } = range;
    if (!Number.isFinite(start) || start < 1) return [];
    const endLine = Number.isFinite(end) && end > start ? end : start;
    return [{
        range: { startLineNumber: start, startColumn: 1, endLineNumber: endLine, endColumn: 1 },
        options: { isWholeLine: true, className: EDITOR_HIGHLIGHT_CLASS },
    }];
}

/**
 * Scroll `line` (one-based) into the centre of the viewport and put the cursor
 * on it. `column` (one-based) is where in the line the cursor lands — column 1
 * for a search hit or a deep link, the symbol's own column when a language
 * server answered with an exact position.
 */
export function revealEditorLine(
    editor: Pick<monacoEditor.IStandaloneCodeEditor, 'revealLineInCenter' | 'setPosition' | 'setSelection'>,
    line: number,
    column = 1,
): void {
    if (!Number.isFinite(line) || line < 1) return;
    const startColumn = Number.isFinite(column) && column >= 1 ? column : 1;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: startColumn });
    editor.setSelection({
        startLineNumber: line, startColumn, endLineNumber: line, endColumn: startColumn,
    });
}

const EXT_TO_MONACO_LANG: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    pyi: 'python',
    pyw: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    php: 'php',
    sql: 'sql',
    graphql: 'graphql',
    xml: 'xml',
    svg: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    markdown: 'markdown',
    mdx: 'markdown',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    toml: 'ini',
    ini: 'ini',
    dockerfile: 'dockerfile',
    makefile: 'plaintext',
    r: 'r',
    lua: 'lua',
    perl: 'perl',
    powershell: 'powershell',
    bat: 'bat',
    cmd: 'bat',
};

export function getMonacoLanguage(fileName: string): string {
    // Handle special filenames first
    const baseName = fileName.toLowerCase();
    if (baseName === 'dockerfile') return 'dockerfile';
    if (baseName === 'makefile') return 'makefile';

    const parts = fileName.split('.');
    if (parts.length < 2) return 'plaintext';
    const ext = parts[parts.length - 1].toLowerCase();

    return EXT_TO_MONACO_LANG[ext] ?? 'plaintext';
}

function resolveIsDark(theme: 'auto' | 'dark' | 'light'): boolean {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Monaco editor options tuned for an explorer preview: minimal chrome, small gutter margin. */
export const EXPLORER_EDITOR_OPTIONS: monacoEditor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    wordWrap: 'on',
    automaticLayout: true,
    readOnly: false,
    padding: { top: 0, bottom: 0 },
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 8,
    lineNumbersMinChars: 3,
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
    },
};

export function MonacoFileEditor({
    value, language, onChange, onSave, readOnly, revealLine, revealColumn, highlightRange, markers, onModelMount,
}: MonacoFileEditorProps) {
    const { theme } = useTheme();
    const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
    const decorationsRef = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
    // The mounted editor, as state rather than a ref, because the model-mount
    // effect below has to run once it exists.
    const [mounted, setMounted] = useState<{
        editor: monacoEditor.IStandaloneCodeEditor;
        monaco: MonacoNamespace;
    } | null>(null);
    // Bumped whenever Monaco swaps the model out from under us, so the host's
    // registration is torn down with the model it was made for.
    const [modelGeneration, setModelGeneration] = useState(0);
    const modelListenerRef = useRef<{ dispose(): void } | null>(null);

    // Measure the wrapper element and track resizes so Monaco gets explicit
    // pixel dimensions instead of relying on CSS 100% (which causes runaway
    // scrollHeight in flex/overflow containers).
    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;
        const update = () => {
            const { width, height } = el.getBoundingClientRect();
            setDimensions(prev =>
                prev && prev.width === Math.round(width) && prev.height === Math.round(height)
                    ? prev
                    : { width: Math.round(width), height: Math.round(height) },
            );
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Scalars, not the object: callers build a fresh `{ start, end }` each render,
    // so depending on the object identity would re-apply the highlight endlessly.
    const highlightStart = highlightRange?.start;
    const highlightEnd = highlightRange?.end;

    const applyHighlight = useCallback((editor: monacoEditor.IStandaloneCodeEditor) => {
        const decorations = buildHighlightDecorations(
            highlightStart === undefined ? null : { start: highlightStart, end: highlightEnd ?? highlightStart },
        );
        if (decorationsRef.current) {
            decorationsRef.current.set(decorations);
        } else if (typeof editor.createDecorationsCollection === 'function') {
            decorationsRef.current = editor.createDecorationsCollection(decorations);
        }
        if (decorations.length > 0) {
            editor.revealLineInCenter(decorations[0].range.startLineNumber);
        }
    }, [highlightStart, highlightEnd]);

    // Markers are published against the model, not the editor, so a second view
    // of the same file sees them too. Republishing an empty list is how a
    // cleared diagnostic set is removed; skipping the call entirely when the
    // host passes no markers is how a non-language viewer stays out of it.
    const ownsMarkersRef = useRef(false);
    const applyMarkers = useCallback(() => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco || markers === undefined) return;
        const model = editor.getModel();
        if (!model) return;
        ownsMarkersRef.current = true;
        monaco.editor.setModelMarkers(model, LANGUAGE_MARKER_OWNER, [...markers]);
    }, [markers]);

    const handleMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        setMounted({ editor, monaco });
        if (typeof editor.onDidChangeModel === 'function') {
            modelListenerRef.current = editor.onDidChangeModel(() => {
                setModelGeneration(generation => generation + 1);
            });
        }

        if (revealLine !== undefined) revealEditorLine(editor, revealLine, revealColumn);
        applyHighlight(editor);
        applyMarkers();

        if (onSave && !readOnly) {
            editor.addAction({
                id: 'file-save',
                label: 'Save File',
                keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
                run: () => onSave(),
            });
        }
    }, [onSave, readOnly, revealLine, revealColumn, applyHighlight, applyMarkers]);

    // A later reveal (a second search hit in the same already-open file) has no
    // mount to piggyback on, so apply it here too. `value` is a dependency
    // because the content arrives after the editor does: revealing a line before
    // the model is populated would clamp to the end of an empty buffer.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || revealLine === undefined) return;
        revealEditorLine(editor, revealLine, revealColumn);
    }, [revealLine, revealColumn, value]);

    // A later range (a second `file:line` reference into the already-open file)
    // has no mount to piggyback on. `value` is a dependency for the same reason
    // as the reveal effect: the content arrives after the editor does.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        applyHighlight(editor);
    }, [applyHighlight, value]);

    // A later marker set (diagnostics arriving after the editor mounted) has no
    // mount to piggyback on. `value` is a dependency because the model is
    // replaced when the content arrives, and markers set on the old model would
    // be lost with it.
    useEffect(() => {
        applyMarkers();
    }, [applyMarkers, value]);

    // Hand the model up to the host, and take the registration back down with
    // it. `modelGeneration` is a dependency so a model swap re-registers against
    // the new model instead of leaving providers pointed at a disposed one.
    useEffect(() => {
        if (!mounted || !onModelMount) return;
        const model = mounted.editor.getModel();
        if (!model) return;
        const cleanup = onModelMount({ editor: mounted.editor, monaco: mounted.monaco, model });
        return () => { cleanup?.(); };
    }, [mounted, modelGeneration, onModelMount]);

    useEffect(() => () => {
        modelListenerRef.current?.dispose();
        modelListenerRef.current = null;
    }, []);

    // Leaving markers behind would strand squiggles on a model another view may
    // still be showing, so a host that owns markers clears them on the way out.
    useEffect(() => () => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco || !ownsMarkersRef.current) return;
        const model = editor.getModel();
        if (model) monaco.editor.setModelMarkers(model, LANGUAGE_MARKER_OWNER, []);
    }, []);

    const handleChange = useCallback((
        newValue: string | undefined,
        event?: monacoEditor.IModelContentChangedEvent,
    ) => {
        onChange?.(newValue ?? '', event?.changes ?? []);
    }, [onChange]);

    const monacoTheme = resolveIsDark(theme) ? 'vs-dark' : 'vs';

    return (
        <div ref={wrapperRef} className="h-full w-full overflow-hidden" data-testid="monaco-editor-wrapper">
            {dimensions && (
                <Editor
                    width={dimensions.width}
                    height={dimensions.height}
                    value={value}
                    language={language ?? 'plaintext'}
                    theme={monacoTheme}
                    onChange={handleChange}
                    onMount={handleMount}
                    options={readOnly ? { ...EXPLORER_EDITOR_OPTIONS, readOnly: true } : EXPLORER_EDITOR_OPTIONS}
                />
            )}
        </div>
    );
}
