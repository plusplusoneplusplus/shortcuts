import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cssPath = resolve(
    __dirname,
    '../../../../src/server/spa/client/react/features/notes/editor/noteEditor.css',
);
const css = readFileSync(cssPath, 'utf-8');

describe('noteEditor.css theme consistency', () => {
    it('does not use @media (prefers-color-scheme) — all dark mode must use .dark class', () => {
        expect(css).not.toContain('prefers-color-scheme');
    });

    // --- Fenced code blocks (pre) ---

    it('light-mode pre uses a light background', () => {
        // The default (non-.dark) pre rule should have a light bg like #f6f8fa
        const preBlock = css.match(
            /\.note-editor\s+\.ProseMirror\s+pre\s*\{[^}]+\}/,
        );
        expect(preBlock).not.toBeNull();
        const bg = preBlock![0].match(/background:\s*(#[0-9a-fA-F]{6})/);
        expect(bg).not.toBeNull();
        // light backgrounds have high channel values; #f6f8fa → r=0xf6
        const r = parseInt(bg![1].slice(1, 3), 16);
        expect(r).toBeGreaterThan(0xc0);
    });

    it('dark-mode pre uses a dark background', () => {
        const darkPre = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+pre\s*\{[^}]+\}/,
        );
        expect(darkPre).not.toBeNull();
        expect(darkPre![0]).toContain('#1e1e1e');
    });

    it('dark-mode pre sets border-color', () => {
        const darkPre = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+pre\s*\{[^}]+\}/,
        );
        expect(darkPre).not.toBeNull();
        expect(darkPre![0]).toContain('border-color');
    });

    // --- Inline code ---

    it('light-mode inline code has an explicit text color', () => {
        const codeBlock = css.match(
            /\.note-editor\s+\.ProseMirror\s+code\s*\{[^}]+\}/,
        );
        expect(codeBlock).not.toBeNull();
        expect(codeBlock![0]).toMatch(/color:\s*#/);
    });

    it('dark-mode inline code has both background and text color', () => {
        const darkCode = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+code\s*\{[^}]+\}/,
        );
        expect(darkCode).not.toBeNull();
        expect(darkCode![0]).toContain('background');
        expect(darkCode![0]).toMatch(/color:\s*#/);
    });

    // --- pre code reset ---

    it('pre code inherits color and removes background', () => {
        const preCode = css.match(
            /\.note-editor\s+\.ProseMirror\s+pre\s+code\s*\{[^}]+\}/,
        );
        expect(preCode).not.toBeNull();
        expect(preCode![0]).toContain('background: none');
        expect(preCode![0]).toContain('color: inherit');
    });

    // --- Links ---

    it('note editor links always use a pointer cursor', () => {
        const linkRule = css.match(
            /\.note-editor\s+\.ProseMirror\s+a\s*\{[^}]+\}/,
        );
        expect(linkRule).not.toBeNull();
        expect(linkRule![0]).toContain('cursor: pointer');
    });

    // --- Mermaid block toolbar button ---

    it('mermaid toolbar button has a visible border at rest', () => {
        const btnBlock = css.match(
            /\.mermaid-node-view-toolbar\s+button\s*\{[^}]+\}/,
        );
        expect(btnBlock).not.toBeNull();
        expect(btnBlock![0]).toMatch(/border:\s*1px solid #c0c0c0/);
    });

    it('mermaid toolbar button has a visible background at rest', () => {
        const btnBlock = css.match(
            /\.mermaid-node-view-toolbar\s+button\s*\{[^}]+\}/,
        );
        expect(btnBlock).not.toBeNull();
        expect(btnBlock![0]).toContain('background: #f5f5f5');
    });

    it('dark mode mermaid toolbar button has dark border and background', () => {
        const darkBtn = css.match(
            /\.dark\s+\.mermaid-node-view-toolbar\s+button\s*\{[^}]+\}/,
        );
        expect(darkBtn).not.toBeNull();
        expect(darkBtn![0]).toContain('border-color: #555');
        expect(darkBtn![0]).toContain('background: #2d2d2d');
    });
});
