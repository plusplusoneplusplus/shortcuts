import { describe, it, expect } from 'vitest';
import {
    notesLowlight,
    NOTES_CODE_LANGUAGES,
    resolveCodeLanguage,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/notesLowlight';

/**
 * Guards the shared lowlight registry that backs the Notes editor's
 * CodeBlockLowlight extension (RichEditorCore.tsx). Per the feature spec this
 * registers exactly the 16 highlight.js grammars the Git diff viewer uses —
 * deliberately NOT lowlight's `common` bundle — and disables auto-detection so a
 * block with no language renders plain.
 *   - AC-01: highlighting a known-language snippet emits `.hljs-*` token spans
 *     (colored live by the globally-loaded github / github-dark stylesheets);
 *     a block with no language is NOT auto-highlighted.
 *   - AC-03: fence aliases (ts, py, sh, yml, rs, …) resolve to registered langs.
 */

// Walk a hast tree and collect every className token on element nodes.
function collectClassNames(node: any, out: string[] = []): string[] {
    if (node?.type === 'element') {
        const classes = node.properties?.className ?? [];
        for (const c of classes) out.push(String(c));
    }
    for (const child of node?.children ?? []) collectClassNames(child, out);
    return out;
}

const CPP_SNIPPET = [
    '// launch the kernel',
    'int main() {',
    '    const char* msg = "hello";',
    '    return 0;',
    '}',
].join('\n');

describe('notes code-block lowlight registry', () => {
    it('registers exactly the 16 supported grammars', () => {
        for (const { value } of NOTES_CODE_LANGUAGES) {
            expect(notesLowlight.registered(value)).toBe(true);
        }
        expect(notesLowlight.listLanguages().sort()).toEqual(
            NOTES_CODE_LANGUAGES.map((l) => l.value).sort(),
        );
    });

    it('does NOT bundle lowlight `common` grammars outside the 16 (php, ruby, sql)', () => {
        // These ship in lowlight's `common` set but are intentionally excluded —
        // guards the decision against a future accidental `createLowlight(common)`.
        for (const lang of ['php', 'ruby', 'sql', 'kotlin', 'swift', 'perl']) {
            expect(notesLowlight.registered(lang)).toBe(false);
        }
    });

    it('AC-01: honors an explicit language, coloring keywords, strings, and comments', () => {
        const tree = notesLowlight.highlight('cpp', CPP_SNIPPET);
        const classes = collectClassNames(tree);

        expect(classes.length).toBeGreaterThan(0);
        expect(classes.every((c) => c.startsWith('hljs-'))).toBe(true);
        expect(classes).toContain('hljs-keyword'); // int / return / const
        expect(classes).toContain('hljs-string'); // "hello"
        expect(classes).toContain('hljs-comment'); // // launch the kernel
    });

    it('AC-01: does not auto-detect — a block with no language emits no token nodes', () => {
        // The extension calls highlightAuto() when a block has no resolvable
        // language; our registry overrides it to a no-op so the block stays plain.
        const tree = notesLowlight.highlightAuto(CPP_SNIPPET) as any;
        expect(collectClassNames(tree)).toEqual([]);
        expect(tree.children).toEqual([]);
    });
});

describe('resolveCodeLanguage (AC-03 alias map)', () => {
    it('maps common fence aliases to their registered grammar', () => {
        const cases: Record<string, string> = {
            ts: 'typescript',
            tsx: 'typescript',
            js: 'javascript',
            jsx: 'javascript',
            py: 'python',
            sh: 'bash',
            zsh: 'bash',
            yml: 'yaml',
            rs: 'rust',
            htm: 'xml',
            html: 'xml',
            'c++': 'cpp',
            'c#': 'csharp',
        };
        for (const [alias, lang] of Object.entries(cases)) {
            expect(resolveCodeLanguage(alias)).toBe(lang);
        }
    });

    it('passes through canonical names and is case-insensitive / prefix-tolerant', () => {
        expect(resolveCodeLanguage('typescript')).toBe('typescript');
        expect(resolveCodeLanguage('TypeScript')).toBe('typescript');
        expect(resolveCodeLanguage('language-python')).toBe('python');
    });

    it('returns null for unknown, empty, or missing tokens', () => {
        expect(resolveCodeLanguage('brainfuck')).toBeNull();
        expect(resolveCodeLanguage('')).toBeNull();
        expect(resolveCodeLanguage('   ')).toBeNull();
        expect(resolveCodeLanguage(null)).toBeNull();
        expect(resolveCodeLanguage(undefined)).toBeNull();
    });
});
