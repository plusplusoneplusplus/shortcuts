import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

describe('shared embed stylesheet', () => {
    it('contains no CoC selectors or theme dependencies', () => {
        expect(css).not.toMatch(/note-editor|note-link|file-ref|paper-|qa-|pdfjs-|--vscode-/);
        expect(css).not.toMatch(/pdf-region-ask|pdf-popup|textLayer|markdown-body/);
    });

    it('scopes map and PDF shells to the default RichEditor class', () => {
        const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g);
        for (const rule of rules) {
            for (const selector of rule[1].trim().split(',')) {
                expect(selector.trim()).toMatch(/^(\.dark )?\.rich-editor \.ProseMirror \.(map|pdf)-node-view/);
            }
        }
        for (const selector of ['.map-node-view', '.map-node-view-source', '.map-node-view-error', '.pdf-node-view', '.pdf-node-view-frame-inner', '.pdf-node-view-resize-handle', '.pdf-node-view-link-only', '.pdf-node-view-error']) {
            expect(css).toContain(`.rich-editor .ProseMirror ${selector}`);
        }
        expect(css).toContain('.dark .rich-editor .ProseMirror .map-node-view-source');
        expect(css).toContain('.dark .rich-editor .ProseMirror .pdf-node-view-link-only');
    });

    it('exports CSS and preserves it as a published side effect', () => {
        expect(manifest.exports['./styles.css']).toBe('./dist/styles.css');
        expect(manifest.sideEffects).toContain('*.css');
        expect(manifest.files).toContain('dist');
    });
});
