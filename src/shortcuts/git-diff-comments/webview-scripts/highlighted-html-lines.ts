/**
 * Utilities for working with syntax-highlighted HTML (e.g., highlight.js output).
 *
 * highlight.js can emit tags (typically <span>) that span across newline boundaries.
 * If we naively split the HTML string by '\n' and wrap each line in its own element,
 * we can end up with unbalanced tags per line which causes DOM nesting issues.
 *
 * This helper splits highlighted HTML into per-line fragments while keeping each
 * fragment tag-balanced by temporarily closing and reopening open <span> tags.
 */

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function isOpeningSpanTag(tag: string): boolean {
    return /^<span\b/i.test(tag) && !/^<\/span\b/i.test(tag) && !/\/>\s*$/.test(tag);
}

function isClosingSpanTag(tag: string): boolean {
    return /^<\/span\s*>/i.test(tag);
}

/**
 * Split highlight.js HTML into per-line HTML fragments with balanced tags per line.
 *
 * - Keeps track of currently open <span ...> tags.
 * - On newline boundaries, closes all currently open spans for the current line,
 *   then reopens them at the start of the next line.
 *
 * This ensures each returned line fragment can be safely wrapped in its own element
 * without causing mis-nesting of later wrappers.
 */
export function splitHighlightedHtmlIntoLines(highlightedHtml: string): string[] {
    const html = normalizeLineEndings(highlightedHtml);

    const openSpanStack: string[] = [];
    const lines: string[] = [];

    let current = '';
    let i = 0;

    const closeOpenSpans = (): string => '</span>'.repeat(openSpanStack.length);
    const reopenOpenSpans = (): string => openSpanStack.join('');

    while (i < html.length) {
        const ch = html[i];

        if (ch === '<') {
            const end = html.indexOf('>', i);
            if (end === -1) {
                // Malformed HTML; treat remainder as text
                current += html.slice(i);
                break;
            }

            const tag = html.slice(i, end + 1);

            if (isOpeningSpanTag(tag)) {
                openSpanStack.push(tag);
                current += tag;
            } else if (isClosingSpanTag(tag)) {
                if (openSpanStack.length > 0) {
                    openSpanStack.pop();
                }
                current += tag;
            } else {
                // Other tags: preserve as-is
                current += tag;
            }

            i = end + 1;
            continue;
        }

        if (ch === '\n') {
            // Finish this line with balanced tags
            lines.push(current + closeOpenSpans());
            // Start next line with reopened tags
            current = reopenOpenSpans();
            i += 1;
            continue;
        }

        current += ch;
        i += 1;
    }

    // Final line
    lines.push(current + closeOpenSpans());
    return lines;
}

/**
 * Map file extension to highlight.js language identifier
 */
export function getLanguageFromFilePath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    const extensionMap: Record<string, string> = {
        // JavaScript/TypeScript
        'js': 'javascript',
        'jsx': 'javascript',
        'mjs': 'javascript',
        'cjs': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'mts': 'typescript',
        'cts': 'typescript',

        // Web
        'html': 'html',
        'htm': 'html',
        'xhtml': 'html',
        'css': 'css',
        'scss': 'scss',
        'sass': 'scss',
        'less': 'less',
        'vue': 'html',
        'svelte': 'html',

        // Data formats
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'xml': 'xml',
        'toml': 'ini',
        'ini': 'ini',

        // Shell
        'sh': 'bash',
        'bash': 'bash',
        'zsh': 'bash',
        'fish': 'bash',
        'ps1': 'powershell',
        'psm1': 'powershell',
        'bat': 'dos',
        'cmd': 'dos',

        // Systems programming
        'c': 'c',
        'h': 'c',
        'cpp': 'cpp',
        'cc': 'cpp',
        'cxx': 'cpp',
        'hpp': 'cpp',
        'hxx': 'cpp',
        'rs': 'rust',
        'go': 'go',
        'zig': 'zig',

        // JVM
        'java': 'java',
        'kt': 'kotlin',
        'kts': 'kotlin',
        'scala': 'scala',
        'groovy': 'groovy',

        // .NET
        'cs': 'csharp',
        'fs': 'fsharp',
        'vb': 'vbnet',

        // Scripting
        'py': 'python',
        'pyw': 'python',
        'rb': 'ruby',
        'php': 'php',
        'pl': 'perl',
        'pm': 'perl',
        'lua': 'lua',
        'r': 'r',

        // Markup
        'md': 'markdown',
        'markdown': 'markdown',
        'rst': 'plaintext',
        'tex': 'latex',
        'latex': 'latex',

        // Config
        'dockerfile': 'dockerfile',
        'makefile': 'makefile',
        'cmake': 'cmake',
        'gradle': 'gradle',

        // Database
        'sql': 'sql',
        'pgsql': 'pgsql',
        'plsql': 'sql',

        // Mobile
        'swift': 'swift',
        'm': 'objectivec',
        'mm': 'objectivec',
        'dart': 'dart',

        // Functional
        'hs': 'haskell',
        'lhs': 'haskell',
        'ml': 'ocaml',
        'mli': 'ocaml',
        'ex': 'elixir',
        'exs': 'elixir',
        'erl': 'erlang',
        'hrl': 'erlang',
        'clj': 'clojure',
        'cljs': 'clojure',
        'cljc': 'clojure',

        // Other
        'graphql': 'graphql',
        'gql': 'graphql',
        'proto': 'protobuf',
        'asm': 'x86asm',
        's': 'x86asm',
        'wasm': 'wasm',
        'vim': 'vim',
        'diff': 'diff',
        'patch': 'diff'
    };

    return extensionMap[ext] || 'plaintext';
}

/**
 * Highlight code using highlight.js (must be loaded globally as hljs)
 */
export function highlightCode(code: string, language: string): string {
    // Check if hljs is available globally
    if (typeof hljs === 'undefined') {
        return escapeHtml(code);
    }

    try {
        // Check if the language is supported
        if (language && language !== 'plaintext' && hljs.getLanguage(language)) {
            return hljs.highlight(code, { language }).value;
        } else if (language === 'plaintext') {
            return escapeHtml(code);
        } else {
            // Auto-detect language
            return hljs.highlightAuto(code).value;
        }
    } catch (e) {
        console.warn('[Diff Webview] Highlight error:', e);
        return escapeHtml(code);
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Declare hljs as a global (loaded from CDN)
declare const hljs: {
    highlight: (code: string, options: { language: string }) => { value: string };
    highlightAuto: (code: string) => { value: string };
    getLanguage: (name: string) => unknown;
};
