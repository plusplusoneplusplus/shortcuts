/**
 * useSyntaxHighlight — language detection and per-line syntax highlighting utilities.
 *
 * Uses highlight.js (selective language imports) to tokenize code content.
 * Returns HTML strings safe for use with dangerouslySetInnerHTML.
 * CSS token colors are provided by the hljs theme stylesheets in html-template.ts.
 */
import hljs from 'highlight.js/lib/core';
import langBash from 'highlight.js/lib/languages/bash';
import langC from 'highlight.js/lib/languages/c';
import langCpp from 'highlight.js/lib/languages/cpp';
import langCsharp from 'highlight.js/lib/languages/csharp';
import langCss from 'highlight.js/lib/languages/css';
import langGo from 'highlight.js/lib/languages/go';
import langJava from 'highlight.js/lib/languages/java';
import langJavascript from 'highlight.js/lib/languages/javascript';
import langJson from 'highlight.js/lib/languages/json';
import langMarkdown from 'highlight.js/lib/languages/markdown';
import langPython from 'highlight.js/lib/languages/python';
import langRust from 'highlight.js/lib/languages/rust';
import langTypescript from 'highlight.js/lib/languages/typescript';
import langXml from 'highlight.js/lib/languages/xml';
import langYaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('typescript', langTypescript);
hljs.registerLanguage('javascript', langJavascript);
hljs.registerLanguage('python', langPython);
hljs.registerLanguage('go', langGo);
hljs.registerLanguage('rust', langRust);
hljs.registerLanguage('java', langJava);
hljs.registerLanguage('c', langC);
hljs.registerLanguage('cpp', langCpp);
hljs.registerLanguage('csharp', langCsharp);
hljs.registerLanguage('json', langJson);
hljs.registerLanguage('yaml', langYaml);
hljs.registerLanguage('bash', langBash);
hljs.registerLanguage('css', langCss);
hljs.registerLanguage('xml', langXml);
hljs.registerLanguage('markdown', langMarkdown);

/** Map from lowercase file extension to highlight.js language name. */
const EXT_TO_LANG: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
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
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    css: 'css',
    html: 'xml',
    htm: 'xml',
    xml: 'xml',
    svg: 'xml',
    md: 'markdown',
    markdown: 'markdown',
};

/** Escape HTML special characters for safe plain-text rendering. */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Derive highlight.js language name from a file name or path. Returns null for unknown extensions. */
export function getLanguageFromFileName(fileName: string | null | undefined): string | null {
    if (!fileName) return null;
    const parts = fileName.split('.');
    if (parts.length < 2) return null;
    const ext = parts[parts.length - 1].toLowerCase();
    return EXT_TO_LANG[ext] ?? null;
}

/**
 * Highlight a single line of code content, returning HTML safe for dangerouslySetInnerHTML.
 * Falls back to HTML-escaped plain text for unknown languages or on error.
 */
export function highlightLine(content: string, language: string | null): string {
    if (!language || content === '') return escapeHtml(content);
    try {
        return hljs.highlight(content, { language, ignoreIllegals: true }).value;
    } catch {
        return escapeHtml(content);
    }
}
