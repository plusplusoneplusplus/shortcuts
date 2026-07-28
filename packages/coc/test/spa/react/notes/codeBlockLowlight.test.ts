import { describe, it, expect } from 'vitest';
import { createLowlight, common } from 'lowlight';

/**
 * Guards the lowlight registry that backs the Notes editor's CodeBlockLowlight
 * extension (RichEditorCore.tsx). These assert the two things the feature relies
 * on at the grammar level:
 *   - AC-01: highlighting a snippet emits `.hljs-*` token spans (which the
 *     globally-loaded github / github-dark stylesheets color live).
 *   - AC-02: an explicit fence language (e.g. `cpp`) is honored, and lowlight
 *     auto-detection colors a block with no language.
 * `common` (not `all`) must include C/C++, Python, JS/TS, Go, Rust.
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
    '    dim3 grid(16, 16);',
    '    const char* msg = "hello";',
    '    return 0;',
    '}',
].join('\n');

describe('notes code-block lowlight registry', () => {
    const lowlight = createLowlight(common);

    it('bundles the common language set (C++, Python, JS/TS, Go, Rust)', () => {
        for (const lang of ['cpp', 'python', 'javascript', 'typescript', 'go', 'rust']) {
            expect(lowlight.registered(lang)).toBe(true);
        }
    });

    it('does not register a CUDA grammar (cpp is the documented closest match)', () => {
        // CUDA is not a highlight.js language; the feature deliberately maps such
        // snippets to `cpp`. Guards the decision against a future accidental add.
        expect(lowlight.registered('cuda')).toBe(false);
        expect(lowlight.registered('cpp')).toBe(true);
    });

    it('AC-02: honors an explicit `cpp` fence, coloring keywords, strings, and comments', () => {
        const tree = lowlight.highlight('cpp', CPP_SNIPPET);
        const classes = collectClassNames(tree);

        // Every token span carries an hljs-prefixed class the theme stylesheets color.
        expect(classes.length).toBeGreaterThan(0);
        expect(classes.every((c) => c.startsWith('hljs-'))).toBe(true);
        expect(classes).toContain('hljs-keyword'); // int / return / const
        expect(classes).toContain('hljs-string'); // "hello"
        expect(classes).toContain('hljs-comment'); // // launch the kernel
    });

    it('AC-02: auto-detects a language and still emits colored tokens with no fence', () => {
        const tree = lowlight.highlightAuto(CPP_SNIPPET);
        const classes = collectClassNames(tree);

        expect(classes.length).toBeGreaterThan(0);
        expect(classes.some((c) => c.startsWith('hljs-'))).toBe(true);
    });
});
