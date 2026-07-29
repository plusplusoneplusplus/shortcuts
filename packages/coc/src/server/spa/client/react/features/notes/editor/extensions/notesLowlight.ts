/**
 * notesLowlight — shared lowlight registry for the Notes editor's fenced code
 * blocks (CodeBlockLowlight, RichEditorCore.tsx).
 *
 * Registers exactly the same 16 highlight.js grammars the read-only Git diff
 * viewer uses (useSyntaxHighlight.ts) — deliberately NOT lowlight's `common`
 * bundle. The `.hljs-*` token spans it emits are colored by the globally-loaded
 * github / github-dark stylesheets (html-template.ts), toggled by ThemeProvider,
 * so light + dark highlighting follow automatically.
 *
 * Auto-detection is disabled: a code block with no `language` attribute (the
 * default for a new block and for a plain ```` ``` ```` fence) renders as plain,
 * uncolored text. Only a block whose language resolves to one of the 16
 * registered grammars is highlighted. This mirrors the read-only viewers, which
 * never call `highlightAuto` either.
 */
import { createLowlight } from 'lowlight';
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
import langPowershell from 'highlight.js/lib/languages/powershell';
import langPython from 'highlight.js/lib/languages/python';
import langRust from 'highlight.js/lib/languages/rust';
import langTypescript from 'highlight.js/lib/languages/typescript';
import langXml from 'highlight.js/lib/languages/xml';
import langYaml from 'highlight.js/lib/languages/yaml';

/**
 * The 16 supported code-block languages, in dropdown display order. `value` is
 * the highlight.js grammar name stored on the node's `language` attribute (and
 * serialized as the markdown fence info-string); `label` is the human name shown
 * in the per-block language picker (AC-02).
 */
export interface NotesCodeLanguage {
    value: string;
    label: string;
}

export const NOTES_CODE_LANGUAGES: readonly NotesCodeLanguage[] = [
    { value: 'typescript', label: 'TypeScript' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'python', label: 'Python' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'java', label: 'Java' },
    { value: 'c', label: 'C' },
    { value: 'cpp', label: 'C++' },
    { value: 'csharp', label: 'C#' },
    { value: 'json', label: 'JSON' },
    { value: 'yaml', label: 'YAML' },
    { value: 'bash', label: 'Bash' },
    { value: 'powershell', label: 'PowerShell' },
    { value: 'css', label: 'CSS' },
    { value: 'xml', label: 'HTML / XML' },
    { value: 'markdown', label: 'Markdown' },
] as const;

/** Set of the 16 registered grammar names for O(1) membership checks. */
const REGISTERED = new Set(NOTES_CODE_LANGUAGES.map((l) => l.value));

/**
 * Fence-token / alias → registered grammar name. Mirrors the extension map in
 * useSyntaxHighlight.ts so a markdown fence like ```` ```ts ````, ```` ```py ````
 * or ```` ```sh ```` resolves to its registered language on import (AC-03). Keys
 * are lowercase. The 16 canonical names map to themselves via REGISTERED, so they
 * do not need entries here.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    py3: 'python',
    rs: 'rust',
    'c++': 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    h: 'c',
    cs: 'csharp',
    'c#': 'csharp',
    csharp: 'csharp',
    yml: 'yaml',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    ps: 'powershell',
    ps1: 'powershell',
    pwsh: 'powershell',
    html: 'xml',
    htm: 'xml',
    svg: 'xml',
    xhtml: 'xml',
    md: 'markdown',
    mkd: 'markdown',
    golang: 'go',
};

/**
 * Resolve a raw fence info-string / language token to one of the 16 registered
 * grammar names, or `null` when it is unknown/empty (→ the block stays plain).
 * Case-insensitive; a leading `language-` class prefix is tolerated.
 */
export function resolveCodeLanguage(token: string | null | undefined): string | null {
    if (!token) return null;
    const key = token.trim().toLowerCase().replace(/^language-/, '');
    if (!key) return null;
    if (REGISTERED.has(key)) return key;
    return LANGUAGE_ALIASES[key] ?? null;
}

// Build the registry once at module load. `createLowlight()` starts empty — we
// register only the 16 grammars above (never `common`).
const registry = createLowlight();
registry.register('typescript', langTypescript);
registry.register('javascript', langJavascript);
registry.register('python', langPython);
registry.register('go', langGo);
registry.register('rust', langRust);
registry.register('java', langJava);
registry.register('c', langC);
registry.register('cpp', langCpp);
registry.register('csharp', langCsharp);
registry.register('json', langJson);
registry.register('yaml', langYaml);
registry.register('bash', langBash);
registry.register('powershell', langPowershell);
registry.register('css', langCss);
registry.register('xml', langXml);
registry.register('markdown', langMarkdown);

// Empty hast root — the shape `getHighlightNodes` reads (`result.children`).
const EMPTY_ROOT = { type: 'root' as const, children: [] as unknown[] };

/**
 * The lowlight instance handed to CodeBlockLowlight. It delegates `highlight` and
 * `listLanguages` to the real registry, but overrides `highlightAuto` to a no-op
 * that emits no token nodes — so a block with no (or an unknown) language renders
 * plain instead of being auto-detected. The extension only calls `highlightAuto`
 * when the node has no resolvable language, which is exactly the plain-text case.
 */
export const notesLowlight = {
    highlight: (language: string, value: string, options?: unknown) =>
        // @ts-expect-error — lowlight's highlight signature accepts optional opts.
        registry.highlight(language, value, options),
    highlightAuto: () => EMPTY_ROOT,
    listLanguages: () => registry.listLanguages(),
    registered: (aliasOrLanguage: string) => registry.registered(aliasOrLanguage),
};
