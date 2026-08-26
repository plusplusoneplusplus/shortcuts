/**
 * MonacoFileEditor — React wrapper around Monaco Editor for file editing.
 *
 * Provides syntax highlighting, theme syncing, and Ctrl+S save keybinding.
 * Also serves as a read-only viewer (`readOnly`, no `onChange`/`onSave`), with
 * optional line reveal and whole-line range highlighting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useTheme } from '../../../layout/ThemeProvider';

/** One-based inclusive line range to highlight (`end === start` for one line). */
export interface EditorHighlightRange {
    start: number;
    end: number;
}

export interface MonacoFileEditorProps {
    value: string;
    language: string | null;
    /** Omitted by read-only viewers, which have nothing to do with edits. */
    onChange?: (value: string) => void;
    onSave?: () => void;
    /** When true the editor is non-editable and the save keybinding is suppressed. */
    readOnly?: boolean;
    /**
     * One-based line to scroll into view and select once the editor is ready.
     * Applied on mount and whenever it changes, so opening a second search hit in
     * the same file jumps to the new line.
     */
    revealLine?: number;
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

/** Scroll `line` (one-based) into the centre of the viewport and select it. */
export function revealEditorLine(
    editor: Pick<monacoEditor.IStandaloneCodeEditor, 'revealLineInCenter' | 'setPosition' | 'setSelection'>,
    line: number,
): void {
    if (!Number.isFinite(line) || line < 1) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 });
}

/** Map file extensions to Monaco language IDs. */
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

/** Resolve a Monaco language ID from a file name extension. */
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
    value, language, onChange, onSave, readOnly, revealLine, highlightRange,
}: MonacoFileEditorProps) {
    const { theme } = useTheme();
    const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
    const decorationsRef = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

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

    const handleMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor;

        if (revealLine !== undefined) revealEditorLine(editor, revealLine);
        applyHighlight(editor);

        if (onSave && !readOnly) {
            editor.addAction({
                id: 'file-save',
                label: 'Save File',
                keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
                run: () => onSave(),
            });
        }
    }, [onSave, readOnly, revealLine, applyHighlight]);

    // A later reveal (a second search hit in the same already-open file) has no
    // mount to piggyback on, so apply it here too. `value` is a dependency
    // because the content arrives after the editor does: revealing a line before
    // the model is populated would clamp to the end of an empty buffer.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || revealLine === undefined) return;
        revealEditorLine(editor, revealLine);
    }, [revealLine, value]);

    // A later range (a second `file:line` reference into the already-open file)
    // has no mount to piggyback on. `value` is a dependency for the same reason
    // as the reveal effect: the content arrives after the editor does.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        applyHighlight(editor);
    }, [applyHighlight, value]);

    const handleChange = useCallback((newValue: string | undefined) => {
        onChange?.(newValue ?? '');
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
