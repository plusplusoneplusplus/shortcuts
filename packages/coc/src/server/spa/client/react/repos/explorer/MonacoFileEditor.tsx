/**
 * MonacoFileEditor — React wrapper around Monaco Editor for file editing.
 *
 * Provides syntax highlighting, theme syncing, and Ctrl+S save keybinding.
 */

import { useCallback, useRef } from 'react';
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

export function MonacoFileEditor({ value, language, onChange, onSave }: MonacoFileEditorProps) {
    const { theme } = useTheme();
    const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);

    const handleMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor;

        // Ctrl+S / Cmd+S keybinding for save
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
        <div className="h-full w-full" data-testid="monaco-editor-wrapper">
            <Editor
                value={value}
                language={language ?? 'plaintext'}
                theme={monacoTheme}
                onChange={handleChange}
                onMount={handleMount}
                options={{
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    wordWrap: 'on',
                    automaticLayout: true,
                    readOnly: false,
                }}
            />
        </div>
    );
}
