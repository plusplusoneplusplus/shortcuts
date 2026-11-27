import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

describe('shared editor stylesheet', () => {
    it('contains no CoC selectors or theme dependencies', () => {
        expect(css).not.toMatch(/note-editor|note-table-|note-link|file-ref|paper-|qa-|pdfjs-|--vscode-/);
        expect(css).not.toMatch(/notes-code-block|ai-edit-|markdown-body/);
    });

    it('scopes content and node views to the default RichEditor class', () => {
        const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g);
        for (const rule of rules) {
            for (const selector of rule[1].trim().split(',')) {
                expect(selector.trim()).toMatch(/^(\.dark )?\.rich-editor(?: \.ProseMirror.*)?$/);
            }
        }
        for (const selector of ['h1', 'ul', 'blockquote', 'code', 'hr', 'a', 'mark', 'table', '[data-indent="1"]', 'span[data-comment-id]', '.block-comment', '.mermaid-node-view', '.find-and-replace-result']) {
            expect(css).toContain(`.rich-editor .ProseMirror ${selector}`);
        }
    });

    it('defines both table palettes on the editor wrapper', () => {
        const light = css.match(/(?:^|\n)\.rich-editor\s*\{([^}]+)\}/)?.[1];
        const dark = css.match(/\.dark \.rich-editor\s*\{([^}]+)\}/)?.[1];
        for (const token of ['yellow', 'green', 'blue', 'pink', 'orange', 'purple']) {
            expect(light).toContain(`--rich-editor-table-bg-${token}:`);
            expect(dark).toContain(`--rich-editor-table-bg-${token}:`);
        }
    });

    it('uses the generic table no-wrap limit', () => {
        expect(css).toContain('max-width: var(--rich-editor-table-nowrap-max, 24rem)');
    });

    it('exports CSS and preserves it as a published side effect', () => {
        expect(manifest.exports['./styles.css']).toBe('./dist/styles.css');
        expect(manifest.sideEffects).toContain('*.css');
        expect(manifest.files).toContain('dist');
    });
});
