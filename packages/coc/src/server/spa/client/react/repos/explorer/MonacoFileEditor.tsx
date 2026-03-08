/**
 * MonacoFileEditor — React wrapper around Monaco Editor for file editing.
 *
 * Provides syntax highlighting, theme syncing, and Ctrl+S save keybinding.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useTheme } from '../../layout/ThemeProvider';

export interface MonacoFileEditorProps {
    value: string;
    language: string | null;
    onChange: (value: string) => void;
    onSave?: () => void;
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

/** Monaco editor options tuned for an explorer preview: no chrome, no margins. */
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
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 3,
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
    },
};

export function MonacoFileEditor({ value, language, onChange, onSave }: MonacoFileEditorProps) {
    const { theme } = useTheme();
    const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
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

    const handleMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor;

        if (onSave) {
            editor.addAction({
                id: 'file-save',
                label: 'Save File',
                keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
                run: () => onSave(),
            });
        }
    }, [onSave]);

    const handleChange = useCallback((newValue: string | undefined) => {
        onChange(newValue ?? '');
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
                    options={EXPLORER_EDITOR_OPTIONS}
                />
            )}
        </div>
    );
}
